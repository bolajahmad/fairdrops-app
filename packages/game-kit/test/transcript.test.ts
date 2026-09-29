import type { Hex } from "@fairdrops/shared";
import { describe, expect, it } from "vitest";
import { quiz } from "../src/games/quiz.js";
import { hashJson } from "../src/hash.js";
import { configJsonSchema, findHostedGame, findResourceKind } from "../src/registry.js";
import { Rng } from "../src/rng.js";
import {
  hostedTranscriptSchema,
  replay,
  transcriptHash,
  verifyTranscript,
  type HostedTranscript,
} from "../src/transcript.js";
import { ALICE, BANK_HASH, BOB, SEED, START, bank } from "./fixtures.js";

const SLOT = 13_000;

/** Plays a short quiz the way the runtime does and records its transcript. */
function playQuiz(): HostedTranscript {
  const config = quiz.config.parse({ bank: BANK_HASH, questions: 2, secondsPerQuestion: 10 });
  const players = [ALICE, BOB];
  const resources = new Map<Hex, unknown>([[BANK_HASH, bank]]);
  const state = quiz.init({ config, players, startAt: START, rng: Rng.fromSeed(SEED), resources });

  const right = (q: number) => state.questions[q]!.answer;
  const wrong = (q: number) => (right(q) + 1) % 4;
  // Alice is right once; Bob is wrong on the first question, late on a retry, then right.
  const moves = [
    { player: ALICE, at: START + 2_000, action: { type: "answer", question: 0, choice: right(0) } },
    { player: BOB, at: START + 3_000, action: { type: "answer", question: 0, choice: wrong(0) } },
    { player: BOB, at: START + 20_000, action: { type: "answer", question: 0, choice: right(0) } },
    {
      player: BOB,
      at: START + SLOT + 500,
      action: { type: "answer", question: 1, choice: right(1) },
    },
  ];
  const actions = moves.map((move, seq) => {
    quiz.apply(state, quiz.action.parse(move.action), { player: move.player, seq, at: move.at });
    return { seq, ...move };
  });

  return hostedTranscriptSchema.parse({
    v: 1,
    mode: "HOSTED",
    session: {
      id: "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
      chainId: 84532,
      contract: "0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca",
      giveawayId: `0x${"12".repeat(32)}`,
    },
    game: { id: quiz.id, version: quiz.version },
    config,
    seed: SEED,
    startAt: START,
    endAt: START + quiz.duration(config),
    players,
    resources: [{ kind: "quiz-bank", hash: BANK_HASH, content: bank }],
    actions,
    ranking: quiz.rank(state),
  });
}

describe("transcripts", () => {
  it("replay to the recorded standings", () => {
    const transcript = playQuiz();
    // One correct answer each; Bob's took 500 ms against Alice's 2000 ms.
    expect(transcript.ranking).toEqual([
      { player: BOB, score: 1, rank: 1 },
      { player: ALICE, score: 1, rank: 2 },
    ]);
    expect(replay(transcript)).toEqual(transcript.ranking);
    expect(verifyTranscript(transcript)).toEqual({ ok: true });
  });

  it("detect a changed action", () => {
    const transcript = playQuiz();
    // Give Bob Alice's (correct) first answer, which would make him the winner.
    transcript.actions[1]!.action = transcript.actions[0]!.action;
    expect(verifyTranscript(transcript)).toEqual({
      ok: false,
      reason: "Replaying the actions gives different standings",
    });
  });

  it("detect a tampered resource or a gap in the log", () => {
    const tampered = playQuiz();
    tampered.resources[0]!.content = { ...bank, name: "Other" };
    expect(verifyTranscript(tampered)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("does not match its content") as string,
    });

    const gap = playQuiz();
    gap.actions.splice(1, 1);
    expect(verifyTranscript(gap)).toEqual({ ok: false, reason: "Action 1 has seq 2" });
  });

  it("hash the same whatever the key order", () => {
    const transcript = playQuiz();
    const reverseKeys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value !== null && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([k, v]) => [k, reverseKeys(v)]),
            )
          : value;
    const reordered = reverseKeys(transcript) as HostedTranscript;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(transcript)[0]);
    expect(transcriptHash(reordered)).toBe(transcriptHash(transcript));
    expect(transcriptHash(transcript)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashJson({ b: 1, a: 2 })).toBe(hashJson({ a: 2, b: 1 }));
  });
});

describe("registry", () => {
  it("finds hosted games and resource kinds", () => {
    expect(findHostedGame("quiz", "1.0.0")?.name).toBe("Quiz");
    expect(findHostedGame("dice", "1.0.0")?.name).toBe("Dice");
    expect(findHostedGame("quiz", "9.9.9")).toBeUndefined();
    expect(findResourceKind("quiz-bank")?.summary(bank)).toBe("Sample: 12 questions");
  });

  it("describes configs as JSON Schema for game definitions", () => {
    const schema = configJsonSchema(findHostedGame("quiz", "1.0.0")!);
    expect(schema).toMatchObject({ type: "object", required: ["bank"] });
    expect(schema.properties).toHaveProperty("secondsPerQuestion");
  });
});
