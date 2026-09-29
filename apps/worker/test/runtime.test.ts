import {
  Rng,
  hostedTranscriptSchema,
  quiz,
  transcriptHash,
  verifyTranscript,
} from "@fairdrops/game-kit";
import {
  sessionEventSchema,
  sessionKeys,
  type Address,
  type SessionEvent,
} from "@fairdrops/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BANK_HASH,
  bank,
  createHarness,
  owner,
  registerGames,
  runningSession,
  send,
  type Harness,
} from "./sessions-harness.js";

let h: Harness;
const ALICE = "0x00000000000000000000000000000000000000a1" as Address;
const BOB = "0x00000000000000000000000000000000000000b2" as Address;
const MALLORY = "0x00000000000000000000000000000000000000ff" as Address;
const roll = { type: "roll" };

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

/** Collects the events a gateway would receive for a session. */
async function listen(sessionId: string) {
  const subscriber = h.redis.duplicate();
  const events: SessionEvent[] = [];
  subscriber.on("message", (_channel: string, message: string) => {
    events.push(sessionEventSchema.parse(JSON.parse(message)));
  });
  await subscriber.subscribe(sessionKeys.events(sessionId));
  return { events, close: () => subscriber.disconnect() };
}

async function settledTranscript(sessionId: string) {
  const session = await h.db.gameSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { transcript: true },
  });
  const transcript = hostedTranscriptSchema.parse(session.transcript!.content);
  return { session, transcript };
}

describe("session runtime", () => {
  it("plays a dice game from the action stream to a verifiable result", async () => {
    // A 30 second window that started 29 seconds ago: the game ends in about a second.
    const session = await runningSession(
      h,
      { id: "dice", config: { windowSeconds: 30 } },
      [ALICE, BOB],
      29_000,
    );
    const feed = await listen(session.id);

    await send(h.redis, session.id, ALICE, "a1", roll);
    await send(h.redis, session.id, ALICE, "a1", roll); // A resend: logged once.
    await send(h.redis, session.id, BOB, "b1", roll);
    await send(h.redis, session.id, MALLORY, "m1", roll); // Not a player: ignored.
    await send(h.redis, session.id, BOB, "b2", { type: "cheat" }); // Invalid: ignored.
    await send(h.redis, session.id, ALICE, "a2", roll);

    await expect((await owner(h, session.id)).run()).resolves.toBe("settled");

    const { session: settled, transcript } = await settledTranscript(session.id);
    expect(settled.status).toBe("SETTLING");
    expect(transcript.actions.map((a) => [a.seq, a.player])).toEqual([
      [0, ALICE],
      [1, BOB],
      [2, ALICE],
    ]);
    expect(transcript.players).toEqual([ALICE, BOB]);
    expect(verifyTranscript(transcript)).toEqual({ ok: true });
    expect(transcriptHash(transcript)).toBe(settled.transcriptHash);
    expect(settled.ranking).toEqual(transcript.ranking);
    expect(settled.seed).toBe(transcript.seed);
    expect(settled.actionCount).toBe(3);

    // Players got results for their actions; everyone got the final standings.
    const results = feed.events.flatMap((e) => (e.kind === "player" && e.result ? [e.result] : []));
    expect(results.map((r) => [r.id, r.accepted])).toEqual([
      ["a1", true],
      ["b1", true],
      ["a2", true],
    ]);
    expect(feed.events.at(-1)).toMatchObject({ kind: "player" });
    expect(feed.events).toContainEqual({
      kind: "status",
      status: "SETTLING",
      ranking: transcript.ranking,
    });
    const stored = JSON.parse((await h.redis.get(sessionKeys.publicView(session.id)))!) as {
      phase: string;
    };
    expect(stored.phase).toBe("finished");
    await expect(h.redis.exists(sessionKeys.actions(session.id))).resolves.toBe(0);
    feed.close();
  });

  it("scores a quiz, rejecting late answers but logging them", async () => {
    // One 5 second question that opened 3.5 seconds ago.
    const config = { bank: BANK_HASH, questions: 1, secondsPerQuestion: 5, revealSeconds: 0 };
    const session = await runningSession(h, { id: "quiz", config }, [ALICE, BOB], 3_500);
    const running = owner(h, session.id).then((o) => o.run());

    // Work out the drawn question the same way the game does, to answer it correctly.
    const state = quiz.init({
      config: quiz.config.parse(config),
      players: [ALICE, BOB],
      startAt: session.startsAt.getTime(),
      rng: Rng.fromSeed(h.vault.decrypt(session.seedCiphertext)),
      resources: new Map([[BANK_HASH, bank]]),
    });
    const answer = state.questions[0]!.answer;
    await send(h.redis, session.id, BOB, "b", {
      type: "answer",
      question: 0,
      choice: (answer + 1) % 3,
    });
    await send(h.redis, session.id, ALICE, "a", { type: "answer", question: 0, choice: answer });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await send(h.redis, session.id, BOB, "late", { type: "answer", question: 0, choice: answer });

    await expect(running).resolves.toBe("settled");
    const { transcript } = await settledTranscript(session.id);
    expect(transcript.ranking).toEqual([
      { player: ALICE, score: 1, rank: 1 },
      { player: BOB, score: 0, rank: 2 },
    ]);
    const logged = await h.db.sessionAction.findMany({ orderBy: { seq: "asc" } });
    expect(logged.map((a) => [a.clientId, a.accepted])).toEqual([
      ["b", true],
      ["a", true],
    ]);
    expect(verifyTranscript(transcript)).toEqual({ ok: true });
    expect(transcript.resources).toEqual([{ kind: "quiz-bank", hash: BANK_HASH, content: bank }]);
  });

  it("carries on after a restart with the same result, losing no actions", async () => {
    const session = await runningSession(
      h,
      { id: "dice", config: { windowSeconds: 30 } },
      [ALICE, BOB],
      27_000,
    );

    const first = await owner(h, session.id, "worker-a");
    const firstRun = first.run();
    await send(h.redis, session.id, ALICE, "a1", roll);
    await send(h.redis, session.id, BOB, "b1", roll);
    await expect
      .poll(
        async () =>
          (await h.db.gameSession.findUniqueOrThrow({ where: { id: session.id } })).actionCount,
      )
      .toBe(2);
    first.stop();
    await expect(firstRun).resolves.toBe("stopped");

    // Actions sent while no worker runs the game wait in the stream.
    await send(h.redis, session.id, ALICE, "a2", roll);
    await send(h.redis, session.id, ALICE, "a1", roll); // A resend of a logged action.

    await expect((await owner(h, session.id, "worker-b")).run()).resolves.toBe("settled");

    const { transcript } = await settledTranscript(session.id);
    expect(transcript.actions.map((a) => a.player)).toEqual([ALICE, BOB, ALICE]);
    expect(verifyTranscript(transcript)).toEqual({ ok: true });
    expect(transcript.ranking.find((s) => s.player === ALICE)!.score).toBeGreaterThan(0);
  }, 15_000);

  it("stops a runtime whose session was taken over, without writing", async () => {
    const session = await runningSession(
      h,
      { id: "dice", config: { windowSeconds: 30 } },
      [ALICE],
      27_000,
    );
    const stale = await owner(h, session.id, "worker-a");
    const running = stale.run();
    await send(h.redis, session.id, ALICE, "a1", roll);
    await expect
      .poll(
        async () =>
          (await h.db.gameSession.findUniqueOrThrow({ where: { id: session.id } })).actionCount,
      )
      .toBe(1);

    // Another runtime logged something in the meantime (e.g. after this one paused past its lease).
    await h.db.gameSession.update({ where: { id: session.id }, data: { lastStreamId: "1-1" } });
    await send(h.redis, session.id, ALICE, "a2", roll);

    await expect(running).resolves.toBe("lost");
    await expect(h.db.sessionAction.count()).resolves.toBe(1);
  }, 15_000);

  it("gives each running game to one worker at a time", async () => {
    const session = await runningSession(
      h,
      { id: "dice", config: { windowSeconds: 30 } },
      [ALICE],
      29_500,
    );
    await owner(h, session.id, "elsewhere");
    await expect(h.supervisor.claim()).resolves.toBe(0);

    await h.redis.del(sessionKeys.owner(session.id));
    await expect(h.supervisor.claim()).resolves.toBe(1);
    expect(h.supervisor.running()).toEqual([session.id]);
    await expect
      .poll(
        async () =>
          (await h.db.gameSession.findUniqueOrThrow({ where: { id: session.id } })).status,
        {
          timeout: 5_000,
        },
      )
      .toBe("SETTLING");
  }, 15_000);
});
