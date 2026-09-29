import type { Hex } from "@fairdrops/shared";
import { describe, expect, it } from "vitest";
import { quiz, quizBankSchema, type QuizState } from "../src/games/quiz.js";
import { Rng } from "../src/rng.js";
import { ALICE, BANK_HASH, BOB, CAROL, SEED, START, bank } from "./fixtures.js";

const config = quiz.config.parse({ bank: BANK_HASH, questions: 3, secondsPerQuestion: 10 });
const resources = new Map<Hex, unknown>([[BANK_HASH, bank]]);
const SLOT = 13_000;

function start(players = [ALICE, BOB, CAROL]): QuizState {
  return quiz.init({ config, players, startAt: START, rng: Rng.fromSeed(SEED), resources });
}

/** Answers question `q` correctly (or with `choice`) `delay` ms after it opens. */
function answer(state: QuizState, player: typeof ALICE, q: number, delay: number, choice?: number) {
  const correct = state.questions[q]!.answer;
  return quiz.apply(
    state,
    { type: "answer", question: q, choice: choice ?? correct },
    { player, seq: 0, at: START + q * SLOT + delay },
  );
}

describe("quiz", () => {
  it("applies defaults and times the game from the config", () => {
    expect(config).toEqual({
      bank: BANK_HASH,
      questions: 3,
      secondsPerQuestion: 10,
      revealSeconds: 3,
    });
    expect(quiz.duration(config)).toBe(3 * SLOT);
    expect(quiz.checkpoints(config, START)).toEqual([
      START,
      START + 10_000,
      START + SLOT,
      START + SLOT + 10_000,
      START + 2 * SLOT,
      START + 2 * SLOT + 10_000,
      START + 3 * SLOT,
    ]);
  });

  it("checks that the bank exists and is large enough", () => {
    expect(quiz.check(config, resources)).toEqual([]);
    expect(quiz.check(config, new Map())).toEqual([
      expect.stringContaining("missing or invalid") as string,
    ]);
    const big = quiz.config.parse({ bank: BANK_HASH, questions: 20 });
    expect(quiz.check(big, resources)).toEqual(["The bank has 12 questions but the game asks 20"]);
  });

  it("draws the same questions for the same seed", () => {
    const prompts = (seed: Hex) =>
      quiz
        .init({ config, players: [ALICE], startAt: START, rng: Rng.fromSeed(seed), resources })
        .questions.map((q) => q.prompt);
    expect(prompts(SEED)).toEqual(prompts(SEED));
    expect(prompts(SEED)).not.toEqual(prompts(`0x${"11".repeat(32)}`));
  });

  it("accepts one answer per player while a question is open", () => {
    const state = start();
    expect(answer(state, ALICE, 0, 500)).toEqual({ accepted: true });
    expect(answer(state, ALICE, 0, 600)).toEqual({ accepted: false, reason: "Already answered" });
    expect(answer(state, BOB, 0, 10_000)).toEqual({
      accepted: false,
      reason: "Question 0 is not open",
    });
    expect(answer(state, BOB, 1, -1)).toMatchObject({ accepted: false });
    expect(answer(state, BOB, 0, 9_999, 7)).toEqual({ accepted: false, reason: "No such choice" });
    const outsider = "0x00000000000000000000000000000000000000ff" as const;
    expect(answer(state, outsider, 0, 100)).toEqual({ accepted: false, reason: "Not a player" });
  });

  it("hides the answer until the question closes", () => {
    const state = start();
    answer(state, ALICE, 0, 500);

    const open = quiz.publicView(state, START + 5_000);
    expect(open).toMatchObject({ phase: "question", index: 0, answered: 1 });
    expect(JSON.stringify(open)).not.toContain('"answer"');
    expect(open.phase === "question" && open.leaderboard.every((e) => e.score === 0)).toBe(true);
    expect(quiz.playerView(state, ALICE, START + 5_000)).toEqual({
      answers: [{ question: 0, choice: state.questions[0]!.answer, correct: null }],
      score: 0,
    });

    const reveal = quiz.publicView(state, START + 11_000);
    expect(reveal).toMatchObject({
      phase: "reveal",
      answer: state.questions[0]!.answer,
      correctCount: 1,
      nextAt: START + SLOT,
    });
    expect(quiz.playerView(state, ALICE, START + 11_000)).toMatchObject({ score: 1 });
  });

  it("ranks by correct answers, then total time on them, then address", () => {
    const state = start();
    answer(state, ALICE, 0, 4_000);
    answer(state, ALICE, 1, 4_000);
    answer(state, BOB, 0, 1_000);
    answer(state, BOB, 1, 1_000);
    answer(state, CAROL, 0, 100);
    answer(state, CAROL, 1, 100, (state.questions[1]!.answer + 1) % 4);

    expect(quiz.rank(state)).toEqual([
      { player: BOB, score: 2, rank: 1 },
      { player: ALICE, score: 2, rank: 2 },
      { player: CAROL, score: 1, rank: 3 },
    ]);
    expect(quiz.publicView(state, START + 3 * SLOT)).toMatchObject({ phase: "finished" });
  });

  it("validates question banks", () => {
    expect(quizBankSchema.safeParse(bank).success).toBe(true);
    const broken = { ...bank, questions: [{ prompt: "?", choices: ["a", "b"], answer: 2 }] };
    expect(quizBankSchema.safeParse(broken).success).toBe(false);
  });
});
