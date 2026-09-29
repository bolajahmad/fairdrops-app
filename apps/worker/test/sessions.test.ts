import { externalTranscriptSchema, transcriptHash } from "@fairdrops/game-kit";
import type { Address } from "@fairdrops/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedCommitment } from "../src/sessions/seed-vault.js";
import {
  BANK_HASH,
  CHAIN_ID,
  CONTRACT,
  REPORTER,
  createGiveaway,
  createHarness,
  join,
  registerGames,
  sessionFor,
  startedAgo,
  type Harness,
} from "./sessions-harness.js";

let h: Harness;
const ALICE = "0x00000000000000000000000000000000000000a1" as Address;
const BOB = "0x00000000000000000000000000000000000000b2" as Address;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  await registerGames(h.db);
});

async function planned(game: Parameters<typeof createGiveaway>[1]["game"], options = {}) {
  const giveawayId = await createGiveaway(h.db, { game, ...options });
  await h.planner.createSessions();
  return sessionFor(h.db, giveawayId);
}

async function committedWithPlayers(players: Address[]) {
  const session = await planned({ id: "dice" });
  await h.queues.commitSeed({ data: { sessionId: session.id } });
  await join(h.db, session.id, players);
  return session;
}

describe("planning", () => {
  it("schedules a hosted game with its settings, an encrypted seed and its commitment", async () => {
    const session = await planned({ id: "quiz", config: { bank: BANK_HASH, questions: 3 } });

    expect(session).toMatchObject({
      status: "SCHEDULED",
      mode: "HOSTED",
      gameId: "quiz",
      failureReason: null,
      config: { bank: BANK_HASH, questions: 3, secondsPerQuestion: 15, revealSeconds: 3 },
      seed: null,
    });
    expect(session.endsAt.getTime() - session.startsAt.getTime()).toBe(3 * 18_000);
    const seed = h.vault.decrypt(session.seedCiphertext);
    expect(seedCommitment(session.giveawayId as `0x${string}`, seed)).toBe(session.seedCommitment);
    expect(Buffer.from(session.seedCiphertext).toString("hex")).not.toContain(seed.slice(2));
  });

  it("gives external games until the settlement margin before the finalize deadline", async () => {
    const session = await planned({ id: "racer" }, { deadlineIn: 60 * 60_000 });
    expect(session).toMatchObject({ status: "SCHEDULED", mode: "EXTERNAL" });
    const giveaway = await h.db.giveaway.findFirstOrThrow();
    expect(giveaway.finalizeDeadline.getTime() - session.endsAt.getTime()).toBe(900_000);
  });

  it.each([
    [{ id: "ghost" }, {}, null, "Unknown game ghost@1.0.0"],
    [{ id: "draft" }, {}, "HOSTED", "Game draft@1.0.0 is draft, not approved"],
    [{ id: "quiz", config: {} }, {}, "HOSTED", "Invalid game settings"],
    [
      { id: "quiz", config: { bank: `0x${"9".repeat(64)}` } },
      {},
      "HOSTED",
      "is missing or invalid",
    ],
    [{ id: "quiz", config: { bank: BANK_HASH, questions: 6 } }, {}, "HOSTED", "asks 6"],
    [
      { id: "dice", config: { windowSeconds: 900 } },
      { deadlineIn: 16 * 60_000 },
      "HOSTED",
      "before the finalize deadline",
    ],
    [{ id: "dice" }, { startsIn: -1_000 }, "HOSTED", "start time passed"],
  ] as const)("fails %o with a reason", async (game, options, mode, reason) => {
    const session = await planned(game, options);
    expect(session.status).toBe("FAILED");
    expect(session.mode).toBe(mode);
    expect(session.failureReason).toContain(reason);
  });

  it("plans each giveaway once", async () => {
    await createGiveaway(h.db, { game: { id: "dice" } });
    await expect(h.planner.createSessions()).resolves.toBe(1);
    await expect(h.planner.createSessions()).resolves.toBe(0);
    await expect(h.db.gameSession.count()).resolves.toBe(1);
  });
});

describe("seed commits", () => {
  it("commits the seed and records the transaction", async () => {
    const session = await planned({ id: "dice" });
    await h.queues.commitSeed({ data: { sessionId: session.id } });

    expect(h.committer.calls).toEqual([
      {
        chainId: CHAIN_ID,
        contract: CONTRACT,
        giveawayId: session.giveawayId,
        commitment: session.seedCommitment,
      },
    ]);
    await expect(sessionFor(h.db, session.giveawayId as `0x${string}`)).resolves.toMatchObject({
      status: "SEED_COMMITTED",
      seedCommitTx: `0x${"7".repeat(64)}`,
    });
  });

  it("fails the session when another commitment is already on-chain", async () => {
    const session = await planned({ id: "dice" });
    h.committer.mode = "conflict";
    await h.queues.commitSeed({ data: { sessionId: session.id } });
    await expect(h.db.gameSession.findFirstOrThrow()).resolves.toMatchObject({
      status: "FAILED",
      failureReason: "taken",
    });
  });

  it("leaves the session scheduled on a transient error so the job retries", async () => {
    const session = await planned({ id: "dice" });
    h.committer.mode = "error";
    await expect(h.queues.commitSeed({ data: { sessionId: session.id } })).rejects.toThrow(
      "RPC unavailable",
    );
    await expect(h.db.gameSession.findFirstOrThrow()).resolves.toMatchObject({
      status: "SCHEDULED",
    });
  });
});

describe("starting", () => {
  it("does nothing before the scheduled time", async () => {
    const session = await committedWithPlayers([ALICE]);
    await expect(h.lifecycle.start(session.id)).resolves.toBeNull();
  });

  it("runs a committed session with players", async () => {
    const session = await committedWithPlayers([ALICE, BOB]);
    await startedAgo(h.db, session.id, 0);
    await expect(h.lifecycle.start(session.id)).resolves.toBe("RUNNING");
    await expect(h.db.gameSession.findFirstOrThrow()).resolves.toMatchObject({
      status: "RUNNING",
      startedAt: expect.any(Date) as Date,
    });
    await expect(h.lifecycle.start(session.id)).resolves.toBeNull();
  });

  it("cancels a session nobody joined", async () => {
    const session = await committedWithPlayers([]);
    await startedAgo(h.db, session.id, 0);
    await expect(h.lifecycle.start(session.id)).resolves.toBe("CANCELLED");
    await expect(h.db.gameSession.findFirstOrThrow()).resolves.toMatchObject({
      failureReason: "Nobody joined",
    });
  });

  it("fails a session whose seed was never committed", async () => {
    const session = await planned({ id: "dice" });
    await join(h.db, session.id, [ALICE]);
    await startedAgo(h.db, session.id, 0);
    await expect(h.lifecycle.start(session.id)).resolves.toBe("FAILED");
  });

  it("cancels sessions whose giveaway ended on-chain", async () => {
    const session = await committedWithPlayers([ALICE]);
    await h.db.giveaway.updateMany({ data: { status: "CANCELLED" } });
    await h.planner.reconcile();
    await expect(h.db.gameSession.findFirstOrThrow()).resolves.toMatchObject({
      status: "CANCELLED",
      failureReason: "The giveaway ended on-chain",
    });
    expect(session.id).toBeDefined();
  });

  it("opens the lobby and starts overdue sessions on reconcile", async () => {
    const session = await committedWithPlayers([ALICE]);
    await h.planner.reconcile();
    await expect(h.db.gameSession.findFirstOrThrow()).resolves.toMatchObject({ status: "LOBBY" });

    await startedAgo(h.db, session.id, 10);
    await h.planner.reconcile();
    await expect(h.db.gameSession.findFirstOrThrow()).resolves.toMatchObject({ status: "RUNNING" });
  });
});

describe("external games", () => {
  async function runningExternal() {
    const session = await planned({ id: "racer" });
    await h.queues.commitSeed({ data: { sessionId: session.id } });
    await join(h.db, session.id, [ALICE, BOB]);
    await startedAgo(h.db, session.id, 0);
    await h.lifecycle.start(session.id);
    return session;
  }

  it("settles from the signed score report, in the reported order", async () => {
    const session = await runningExternal();
    await h.db.scoreReport.create({
      data: {
        sessionId: session.id,
        reporter: REPORTER,
        apiKeyId: "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
        ranking: [
          { player: BOB, score: 90 },
          { player: ALICE, score: 40 },
        ],
        signature: "0x1234",
      },
    });

    await h.planner.reconcile();

    const settled = await h.db.gameSession.findFirstOrThrow({ include: { transcript: true } });
    expect(settled).toMatchObject({
      status: "SETTLING",
      ranking: [
        { player: BOB, score: 90, rank: 1 },
        { player: ALICE, score: 40, rank: 2 },
      ],
      seed: h.vault.decrypt(settled.seedCiphertext),
    });
    const transcript = externalTranscriptSchema.parse(settled.transcript!.content);
    expect(transcript).toMatchObject({
      mode: "EXTERNAL",
      players: [ALICE, BOB],
      report: { reporter: REPORTER, signature: "0x1234" },
    });
    expect(transcriptHash(transcript)).toBe(settled.transcriptHash);
  });

  it("fails when no report arrives before the deadline", async () => {
    const session = await runningExternal();
    await h.db.gameSession.update({
      where: { id: session.id },
      data: { endsAt: new Date(Date.now() - 1), startsAt: new Date(Date.now() - 10_000) },
    });
    await h.planner.reconcile();
    await expect(h.db.gameSession.findFirstOrThrow()).resolves.toMatchObject({
      status: "FAILED",
      failureReason: "No score report arrived before the deadline",
    });
  });
});
