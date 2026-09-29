import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import type { Giveaway, GameMode, Prisma, SessionStatus } from "@fairdrops/db";
import { UNIQUE_VIOLATION, Prisma as PrismaNamespace } from "@fairdrops/db";
import { findHostedGame } from "@fairdrops/game-kit";
import { JOINABLE_SESSION_STATUSES, giveawayMetadataSchema, type Hex } from "@fairdrops/shared";
import { Redis } from "ioredis";
import { z } from "zod";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { REDIS } from "../infra/redis.module.js";
import { Lease } from "./lease.js";
import { loadResources, resourceMap } from "./resources.js";
import { SeedVault, seedCommitment } from "./seed-vault.js";
import { SessionLifecycle } from "./session-lifecycle.js";
import { SessionQueues } from "./session-queues.js";
import { WORKER_ID } from "./worker-id.js";

const PLANNER_LEASE_KEY = "fd:lease:session-planner";
/** Rows handled per query, so one tick stays short however far behind the planner is. */
const BATCH = 200;
const PRE_START: SessionStatus[] = [...JOINABLE_SESSION_STATUSES];

interface Plan {
  mode: GameMode | null;
  config: Record<string, unknown>;
  endsAt: Date;
  failure: string | null;
}

/**
 * Creates a session for every new giveaway and keeps sessions moving. One worker plans at a
 * time (a Redis lease); every step is also safe to repeat, so a second planner during a lease
 * handover does no harm.
 */
@Injectable()
export class SessionPlanner implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(SessionPlanner.name);
  private readonly abort = new AbortController();
  private readonly lease: Lease;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
    private readonly vault: SeedVault,
    private readonly lifecycle: SessionLifecycle,
    private readonly queues: SessionQueues,
  ) {
    this.lease = new Lease(
      redis,
      PLANNER_LEASE_KEY,
      WORKER_ID,
      Math.max(env.SESSION_PLANNER_INTERVAL_MS * 5, 5_000),
    );
  }

  onApplicationBootstrap(): void {
    if (this.env.SESSIONS_ENABLED) this.loop = this.run();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.abort.abort();
    await this.loop;
    await this.lease.release().catch(() => undefined);
  }

  private async run(): Promise<void> {
    const { signal } = this.abort;
    while (!signal.aborted) {
      try {
        if ((await this.lease.renew()) || (await this.lease.acquire())) await this.tick();
      } catch (error) {
        this.logger.warn(`Planner tick failed: ${(error as Error).message}`);
      }
      await sleep(this.env.SESSION_PLANNER_INTERVAL_MS, undefined, { signal }).catch(
        () => undefined,
      );
    }
  }

  async tick(now = new Date()): Promise<void> {
    await this.createSessions(now);
    await this.reconcile(now);
  }

  /** One session per active giveaway with valid metadata. */
  async createSessions(now = new Date()): Promise<number> {
    const giveaways = await this.db.giveaway.findMany({
      where: { status: "ACTIVE", metadataError: null, session: null },
      orderBy: { startTime: "asc" },
      take: BATCH,
    });
    let created = 0;
    for (const giveaway of giveaways) {
      if (await this.createSession(giveaway, now)) created += 1;
    }
    return created;
  }

  async reconcile(now = new Date()): Promise<void> {
    const due = (where: Prisma.GameSessionWhereInput) =>
      this.db.gameSession.findMany({ where, select: { id: true, status: true }, take: BATCH });

    // Sessions whose giveaway was cancelled or expired on-chain stop wherever they are.
    for (const session of await due({
      status: { in: [...PRE_START, "RUNNING"] },
      giveaway: { status: { not: "ACTIVE" } },
    })) {
      await this.lifecycle.cancel(session.id, [session.status], "The giveaway ended on-chain");
    }

    // Seed commits, in case a job was lost. Scheduling an existing job is a no-op.
    for (const session of await due({ status: "SCHEDULED", startsAt: { gt: now } })) {
      await this.queues.scheduleCommit(session.id);
    }

    const lobbyFrom = new Date(now.getTime() + this.env.SESSION_LOBBY_LEAD_SECONDS * 1000);
    for (const session of await due({ status: "SEED_COMMITTED", startsAt: { lte: lobbyFrom } })) {
      await this.lifecycle.openLobby(session.id);
    }

    // Starts the queue has not run yet, for example after Redis lost its jobs.
    for (const session of await due({ status: { in: PRE_START }, startsAt: { lte: now } })) {
      await this.lifecycle.start(session.id, now);
    }

    // External games settle when their report arrives, or fail at the deadline without one.
    for (const session of await due({
      status: "RUNNING",
      mode: "EXTERNAL",
      scoreReport: { isNot: null },
    })) {
      await this.lifecycle.settleExternal(session.id, now);
    }
    for (const session of await due({
      status: "RUNNING",
      mode: "EXTERNAL",
      scoreReport: { is: null },
      endsAt: { lte: now },
    })) {
      await this.lifecycle.fail(
        session.id,
        ["RUNNING"],
        "No score report arrived before the deadline",
      );
    }
  }

  private async createSession(giveaway: Giveaway, now: Date): Promise<boolean> {
    const metadata = giveawayMetadataSchema.safeParse(giveaway.metadata);
    if (!metadata.success) return false;
    const plan = await this.plan(giveaway, metadata.data.game, now);
    const seed = this.vault.generate();

    let sessionId: string;
    try {
      const session = await this.db.gameSession.create({
        data: {
          chainId: giveaway.chainId,
          giveawayId: giveaway.giveawayId,
          gameId: metadata.data.game.id,
          gameVersion: metadata.data.game.version,
          mode: plan.mode,
          status: plan.failure ? "FAILED" : "SCHEDULED",
          failureReason: plan.failure,
          config: plan.config as Prisma.InputJsonObject,
          seedCiphertext: this.vault.encrypt(seed),
          seedCommitment: seedCommitment(giveaway.giveawayId as Hex, seed),
          startsAt: giveaway.startTime,
          endsAt: plan.endsAt,
        },
      });
      sessionId = session.id;
    } catch (error) {
      // Another planner created it first.
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        return false;
      }
      throw error;
    }

    this.logger.log(
      `Planned session ${sessionId} for giveaway ${giveaway.giveawayId} on ${giveaway.chainId}` +
        (plan.failure ? `: FAILED (${plan.failure})` : ` at ${giveaway.startTime.toISOString()}`),
    );
    if (!plan.failure) {
      await this.queues.scheduleCommit(sessionId);
      await this.queues.scheduleStart(sessionId, giveaway.startTime);
    }
    return true;
  }

  /** Decides whether the giveaway's game can be played and when it ends. */
  private async plan(
    giveaway: Giveaway,
    game: { id: string; version: string; config: Record<string, unknown> },
    now: Date,
  ): Promise<Plan> {
    const start = giveaway.startTime.getTime();
    const deadline =
      giveaway.finalizeDeadline.getTime() - this.env.SESSION_SETTLEMENT_MARGIN_SECONDS * 1000;
    const failed = (mode: GameMode | null, failure: string): Plan => ({
      mode,
      config: game.config,
      endsAt: new Date(start + 1000),
      failure,
    });
    const name = `${game.id}@${game.version}`;

    const definition = await this.db.gameDefinition.findUnique({
      where: { id_version: { id: game.id, version: game.version } },
      select: { mode: true, status: true },
    });
    if (!definition) return failed(null, `Unknown game ${name}`);
    if (definition.status !== "APPROVED") {
      return failed(
        definition.mode,
        `Game ${name} is ${definition.status.toLowerCase()}, not approved`,
      );
    }
    if (start <= now.getTime()) {
      return failed(definition.mode, "The start time passed before the session was planned");
    }

    if (definition.mode === "EXTERNAL") {
      if (deadline <= start) {
        return failed("EXTERNAL", "There is no time to play before the finalize deadline");
      }
      return { mode: "EXTERNAL", config: game.config, endsAt: new Date(deadline), failure: null };
    }

    const hosted = findHostedGame(game.id, game.version);
    if (!hosted) return failed("HOSTED", `FairDrops cannot run ${name}`);
    const parsed = hosted.config.safeParse(game.config);
    if (!parsed.success) {
      return failed("HOSTED", `Invalid game settings: ${z.prettifyError(parsed.error)}`);
    }
    const resources = await loadResources(this.db, hosted.resources(parsed.data));
    const issues = hosted.check(parsed.data, resourceMap(resources));
    if (issues.length > 0) return failed("HOSTED", issues.join("; "));

    const endsAt = start + hosted.duration(parsed.data);
    if (endsAt > deadline) {
      return failed(
        "HOSTED",
        `The game would end at ${new Date(endsAt).toISOString()}, less than ` +
          `${this.env.SESSION_SETTLEMENT_MARGIN_SECONDS} s before the finalize deadline`,
      );
    }
    return {
      mode: "HOSTED",
      config: parsed.data as Record<string, unknown>,
      endsAt: new Date(endsAt),
      failure: null,
    };
  }
}
