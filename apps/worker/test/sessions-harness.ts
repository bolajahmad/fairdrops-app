import { Test, type TestingModule } from "@nestjs/testing";
import type { Prisma } from "@fairdrops/db";
import { resetDatabase } from "@fairdrops/db/testing";
import { hashJson, quizBankSchema, type QuizBank } from "@fairdrops/game-kit";
import { canonicalJson, sessionKeys, type Address, type Hex } from "@fairdrops/shared";
import { Redis } from "ioredis";
import { keccak256, toHex } from "viem";
import { FAIRDROPS_READER } from "../src/chain/reader.js";
import { CHAIN_RPC } from "../src/chain/rpc.js";
import { PRISMA, type Database } from "../src/infra/prisma.module.js";
import { REDIS } from "../src/infra/redis.module.js";
import { Lease } from "../src/sessions/lease.js";
import {
  SEED_COMMITTER,
  SeedCommitConflict,
  type SeedCommitRequest,
  type SeedCommitter,
} from "../src/sessions/seed-committer.js";
import { SeedVault } from "../src/sessions/seed-vault.js";
import { SessionBus } from "../src/sessions/session-bus.js";
import { SessionLifecycle } from "../src/sessions/session-lifecycle.js";
import { SessionOwner } from "../src/sessions/session-owner.js";
import { SessionPlanner } from "../src/sessions/session-planner.js";
import { SessionQueues } from "../src/sessions/session-queues.js";
import { SessionSupervisor } from "../src/sessions/session-supervisor.js";
import { WorkerModule } from "../src/worker.module.js";
import { FakeChain } from "./fake-chain.js";

export const CHAIN_ID = 84532;
export const CONTRACT = "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72" as Address;
export const REPORTER = "0x00000000000000000000000000000000000000ee" as Address;

export const COMMIT_TX: Hex = `0x${"7".repeat(64)}`;

/** Records commits and can be told to fail, in place of on-chain transactions. */
export class FakeCommitter implements SeedCommitter {
  calls: SeedCommitRequest[] = [];
  mode: "ok" | "conflict" | "error" = "ok";

  commit(request: SeedCommitRequest): Promise<Hex | null> {
    this.calls.push(request);
    if (this.mode === "conflict") return Promise.reject(new SeedCommitConflict("taken"));
    if (this.mode === "error") return Promise.reject(new Error("RPC unavailable"));
    return Promise.resolve(COMMIT_TX);
  }
}

export const bank: QuizBank = quizBankSchema.parse({
  v: 1,
  name: "Test bank",
  questions: Array.from({ length: 5 }, (_, i) => ({
    prompt: `Question ${i}`,
    choices: ["A", "B", "C"],
    answer: i % 3,
  })),
});
export const BANK_HASH = hashJson(bank);

export interface Harness {
  moduleRef: TestingModule;
  db: Database;
  redis: Redis;
  committer: FakeCommitter;
  /** The chain behind every RPC and contract read, reset with the rest. */
  chain: FakeChain;
  planner: SessionPlanner;
  lifecycle: SessionLifecycle;
  queues: SessionQueues;
  supervisor: SessionSupervisor;
  vault: SeedVault;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const committer = new FakeCommitter();
  const chain = new FakeChain(CHAIN_ID, CONTRACT);
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(SEED_COMMITTER)
    .useValue(committer)
    .overrideProvider(CHAIN_RPC)
    .useValue(() => chain)
    .overrideProvider(FAIRDROPS_READER)
    .useValue(chain)
    .compile();
  moduleRef.useLogger(false);
  await moduleRef.init();
  const db = moduleRef.get<Database>(PRISMA);
  const redis = moduleRef.get<Redis>(REDIS);
  return {
    moduleRef,
    db,
    redis,
    committer,
    chain,
    planner: moduleRef.get(SessionPlanner),
    lifecycle: moduleRef.get(SessionLifecycle),
    queues: moduleRef.get(SessionQueues),
    supervisor: moduleRef.get(SessionSupervisor),
    vault: moduleRef.get(SeedVault),
    async reset() {
      committer.calls = [];
      committer.mode = "ok";
      chain.reset();
      await resetDatabase(db);
      await redis.flushdb();
    },
    close: () => moduleRef.close(),
  };
}

/** Registers the games and the question bank the tests use, as approved definitions. */
export async function registerGames(db: Database): Promise<void> {
  const owner = await db.user.create({ data: {} });
  const base = { description: "", configSchema: { type: "object" }, ownerId: owner.id };
  await db.gameDefinition.createMany({
    data: [
      { ...base, id: "quiz", version: "1.0.0", name: "Quiz", mode: "HOSTED", status: "APPROVED" },
      { ...base, id: "dice", version: "1.0.0", name: "Dice", mode: "HOSTED", status: "APPROVED" },
      {
        ...base,
        id: "rounds",
        version: "1.0.0",
        name: "Rounds",
        mode: "HOSTED",
        status: "APPROVED",
      },
      {
        ...base,
        id: "racer",
        version: "1.0.0",
        name: "Racer",
        mode: "EXTERNAL",
        status: "APPROVED",
        reporterAddress: REPORTER,
      },
      { ...base, id: "draft", version: "1.0.0", name: "Draft", mode: "HOSTED" },
    ],
  });
  await db.gameResource.create({
    data: {
      hash: BANK_HASH,
      kind: "quiz-bank",
      summary: "Test bank: 5 questions",
      content: bank,
      createdById: owner.id,
    },
  });
}

let giveawayCounter = 0;

export interface GiveawayOptions {
  game: { id: string; version?: string; config?: Record<string, unknown> };
  /** Play in rounds; the reward policy is then `rewards`, or equal shares for 2 places. */
  rounds?: Record<string, unknown>;
  rewards?: Record<string, unknown>;
  startsIn?: number;
  deadlineIn?: number;
}

/** Inserts a giveaway as the indexer would, and returns its id. */
export async function createGiveaway(db: Database, options: GiveawayOptions): Promise<Hex> {
  giveawayCounter += 1;
  const giveawayId = toHex(giveawayCounter, { size: 32 });
  const game = {
    id: options.game.id,
    version: options.game.version ?? "1.0.0",
    config: options.game.config ?? {},
  };
  const metadata = options.rounds
    ? {
        v: 2,
        title: "Test giveaway",
        description: "",
        game,
        rewards: options.rewards ?? { kind: "equal", winners: 2, minScore: 1 },
        rounds: { cooldownSeconds: 3, next: [], ...options.rounds },
      }
    : { v: 1, title: "Test giveaway", description: "", game };
  const raw = new TextEncoder().encode(canonicalJson(metadata));
  const now = Date.now();
  await db.giveaway.create({
    data: {
      chainId: CHAIN_ID,
      giveawayId,
      contractAddress: CONTRACT,
      host: "0x00000000000000000000000000000000000000a1",
      token: "0x0000000000000000000000000000000000000000",
      prize: "1000",
      fee: "10",
      startTime: new Date(now + (options.startsIn ?? 60_000)),
      finalizeDeadline: new Date(now + (options.deadlineIn ?? 24 * 60 * 60_000)),
      maxWinners: 3,
      claimWindowSeconds: 2_592_000,
      metadataHash: keccak256(raw),
      metadataRaw: raw,
      metadata: metadata as Prisma.InputJsonObject,
      createdBlock: 1n,
      createdTxHash: `0x${"b".repeat(64)}`,
      createdAt: new Date(now),
      updatedBlock: 1n,
    },
  });
  return giveawayId;
}

export async function sessionFor(db: Database, giveawayId: Hex) {
  return db.gameSession.findUniqueOrThrow({
    where: { chainId_giveawayId: { chainId: CHAIN_ID, giveawayId } },
  });
}

/** Adds players to a session, each with their own user. */
export async function join(db: Database, sessionId: string, wallets: Address[]): Promise<void> {
  for (const wallet of wallets) {
    const user = await db.user.create({ data: {} });
    await db.sessionParticipant.create({ data: { sessionId, wallet, userId: user.id } });
  }
}

/** Moves a planned session's schedule so it started `ago` ms ago, keeping its duration. */
export async function startedAgo(db: Database, sessionId: string, ago: number): Promise<void> {
  const session = await db.gameSession.findUniqueOrThrow({ where: { id: sessionId } });
  const duration = session.endsAt.getTime() - session.startsAt.getTime();
  const startsAt = new Date(Date.now() - ago);
  await db.gameSession.update({
    where: { id: sessionId },
    data: { startsAt, endsAt: new Date(startsAt.getTime() + duration) },
  });
}

/** Appends an action to the session's stream, as the API gateway does. */
export async function send(
  redis: Redis,
  sessionId: string,
  player: Address,
  id: string,
  action: unknown,
): Promise<void> {
  await redis.xadd(
    sessionKeys.actions(sessionId),
    "*",
    "player",
    player,
    "id",
    id,
    "action",
    JSON.stringify(action),
  );
}

/** A runtime for one session, holding its lease, as the supervisor would start it. */
export async function owner(h: Harness, sessionId: string, holder = "test"): Promise<SessionOwner> {
  const lease = new Lease(h.redis, sessionKeys.owner(sessionId), holder, 5_000);
  if (!(await lease.acquire())) throw new Error("Lease is held");
  return new SessionOwner(sessionId, lease, {
    db: h.db,
    redis: h.redis,
    bus: h.moduleRef.get(SessionBus),
    lifecycle: h.lifecycle,
    vault: h.vault,
    logger: { log: () => undefined } as never,
  });
}

/** Plans, commits and starts a hosted session that began `ago` ms ago. */
export async function runningSession(
  h: Harness,
  game: GiveawayOptions["game"],
  players: Address[],
  ago: number,
  extra: Omit<GiveawayOptions, "game"> = {},
) {
  const giveawayId = await createGiveaway(h.db, { game, ...extra });
  await h.planner.createSessions();
  const planned = await sessionFor(h.db, giveawayId);
  if (planned.status !== "SCHEDULED")
    throw new Error(`Session ${planned.status}: ${planned.failureReason}`);
  await h.queues.commitSeed({ data: { sessionId: planned.id } });
  await join(h.db, planned.id, players);
  await startedAgo(h.db, planned.id, ago);
  const status = await h.lifecycle.start(planned.id);
  if (status !== "RUNNING") throw new Error(`Session did not start: ${status}`);
  return h.db.gameSession.findUniqueOrThrow({ where: { id: planned.id } });
}
