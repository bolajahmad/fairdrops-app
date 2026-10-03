import { bytes32Schema, type Address } from "@fairdrops/shared";
import { z } from "zod";
import type { Rng } from "../rng.js";
import type { ActionOutcome, HostedGame, ResourceKind, Standing } from "../types.js";
import { compareAddresses, leaderboard, type LeaderboardEntry } from "./common.js";

// Question banks

export const quizBankSchema = z
  .strictObject({
    v: z.literal(1),
    name: z.string().trim().min(1).max(80),
    questions: z
      .array(
        z.strictObject({
          prompt: z.string().trim().min(1).max(300),
          choices: z.array(z.string().trim().min(1).max(120)).min(2).max(6),
          /** Index of the correct choice. */
          answer: z.number().int().nonnegative(),
        }),
      )
      .min(1)
      .max(2000),
  })
  .superRefine((bank, ctx) => {
    bank.questions.forEach((question, i) => {
      if (question.answer >= question.choices.length) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "answer"],
          message: "The answer must be the index of one of the choices",
        });
      }
    });
  });
export type QuizBank = z.infer<typeof quizBankSchema>;
type Question = QuizBank["questions"][number];

/**
 * Banks are uploaded privately and referenced by hash in the giveaway metadata, so the host
 * commits to a bank on-chain before play without revealing the answers. The bank is published
 * in the transcript once the game is over.
 */
export const quizBankKind: ResourceKind<QuizBank> = {
  kind: "quiz-bank",
  schema: quizBankSchema,
  summary: (bank) => `${bank.name}: ${bank.questions.length} questions`,
};

// Game

export const quizConfigSchema = z.strictObject({
  /** Hash of the question bank to draw from. */
  bank: bytes32Schema,
  questions: z.number().int().min(1).max(50).default(10),
  /** Time to read and answer one question. Long questions still have to be answered in time. */
  secondsPerQuestion: z.number().int().min(5).max(30).default(20),
  /** Pause after each question in which the answer is shown. */
  revealSeconds: z.number().int().min(0).max(15).default(3),
});
export type QuizConfig = z.infer<typeof quizConfigSchema>;

export const quizActionSchema = z.strictObject({
  type: z.literal("answer"),
  question: z.number().int().nonnegative(),
  choice: z.number().int().nonnegative(),
});
export type QuizAction = z.infer<typeof quizActionSchema>;

interface Answer {
  choice: number;
  correct: boolean;
  /** Milliseconds from the question opening to the answer arriving. */
  elapsed: number;
}

export interface QuizState {
  startAt: number;
  openMs: number;
  slotMs: number;
  questions: Question[];
  players: Set<Address>;
  answers: Map<Address, (Answer | undefined)[]>;
}

type Phase =
  { phase: "waiting" } | { phase: "question" | "reveal"; index: number } | { phase: "finished" };

export type QuizPublicView =
  | { phase: "waiting"; startsAt: number; questionCount: number }
  | {
      phase: "question";
      index: number;
      questionCount: number;
      prompt: string;
      choices: string[];
      opensAt: number;
      closesAt: number;
      answered: number;
      leaderboard: LeaderboardEntry[];
    }
  | {
      phase: "reveal";
      index: number;
      questionCount: number;
      prompt: string;
      choices: string[];
      answer: number;
      correctCount: number;
      nextAt: number;
      leaderboard: LeaderboardEntry[];
    }
  | { phase: "finished"; questionCount: number; leaderboard: LeaderboardEntry[] };

export interface QuizPlayerView {
  /** One entry per question answered. `correct` stays null until the question closes. */
  answers: { question: number; choice: number; correct: boolean | null }[];
  /** Correct answers among closed questions. */
  score: number;
}

function phaseAt(state: QuizState, now: number): Phase {
  const offset = now - state.startAt;
  if (offset < 0) return { phase: "waiting" };
  const index = Math.floor(offset / state.slotMs);
  if (index >= state.questions.length) return { phase: "finished" };
  return { phase: offset - index * state.slotMs < state.openMs ? "question" : "reveal", index };
}

function openAt(state: QuizState, index: number): number {
  return state.startAt + index * state.slotMs;
}

/** Questions whose answers may be shown at `now`. */
function closedCount(state: QuizState, now: number): number {
  if (now < state.startAt) return 0;
  const offset = now - state.startAt;
  const full = Math.floor(offset / state.slotMs);
  const current = offset - full * state.slotMs >= state.openMs ? 1 : 0;
  return Math.min(full + current, state.questions.length);
}

function tally(state: QuizState, player: Address, upTo: number) {
  let correct = 0;
  let elapsed = 0;
  for (const answer of (state.answers.get(player) ?? []).slice(0, upTo)) {
    if (answer?.correct) {
      correct += 1;
      elapsed += answer.elapsed;
    }
  }
  return { correct, elapsed };
}

/** Most correct answers first, then the faster total time on them, then the lower address. */
function standings(state: QuizState, upTo: number): Standing[] {
  return [...state.players]
    .map((player) => ({ player, ...tally(state, player, upTo) }))
    .sort(
      (a, b) =>
        b.correct - a.correct || a.elapsed - b.elapsed || compareAddresses(a.player, b.player),
    )
    .map((entry, i) => ({ player: entry.player, score: entry.correct, rank: i + 1 }));
}

export const quiz: HostedGame<QuizConfig, QuizState, QuizAction, QuizPublicView, QuizPlayerView> = {
  id: "quiz",
  version: "1.0.0",
  name: "Quiz",
  description:
    "Timed multiple-choice questions drawn from a committed question bank. Most correct answers " +
    "wins; ties go to whoever answered correctly fastest in total.",
  config: quizConfigSchema,
  action: quizActionSchema,

  resources: (config) => [{ kind: quizBankKind.kind, hash: config.bank }],

  check(config, resources) {
    const bank = quizBankSchema.safeParse(resources.get(config.bank));
    if (!bank.success) return [`Question bank ${config.bank} is missing or invalid`];
    if (bank.data.questions.length < config.questions) {
      return [
        `The bank has ${bank.data.questions.length} questions but the game asks ${config.questions}`,
      ];
    }
    return [];
  },

  duration: (config) =>
    config.questions * (config.secondsPerQuestion + config.revealSeconds) * 1000,

  checkpoints(config, startAt) {
    const slot = (config.secondsPerQuestion + config.revealSeconds) * 1000;
    const times: number[] = [];
    for (let i = 0; i < config.questions; i++) {
      times.push(startAt + i * slot);
      if (config.revealSeconds > 0)
        times.push(startAt + i * slot + config.secondsPerQuestion * 1000);
    }
    times.push(startAt + config.questions * slot);
    return times;
  },

  init({ config, players, startAt, rng, resources }) {
    const bank = quizBankSchema.parse(resources.get(config.bank));
    return {
      startAt,
      openMs: config.secondsPerQuestion * 1000,
      slotMs: (config.secondsPerQuestion + config.revealSeconds) * 1000,
      questions: drawQuestions(bank, config.questions, rng.fork("questions")),
      players: new Set(players),
      answers: new Map(),
    };
  },

  apply(state, action, ctx): ActionOutcome {
    if (!state.players.has(ctx.player)) return { accepted: false, reason: "Not a player" };
    const current = phaseAt(state, ctx.at);
    if (current.phase !== "question" || current.index !== action.question) {
      return { accepted: false, reason: `Question ${action.question} is not open` };
    }
    const question = state.questions[action.question]!;
    if (action.choice >= question.choices.length) {
      return { accepted: false, reason: "No such choice" };
    }
    const answers = state.answers.get(ctx.player) ?? [];
    if (answers[action.question]) return { accepted: false, reason: "Already answered" };

    answers[action.question] = {
      choice: action.choice,
      correct: action.choice === question.answer,
      elapsed: ctx.at - openAt(state, action.question),
    };
    state.answers.set(ctx.player, answers);
    return { accepted: true };
  },

  publicView(state, now): QuizPublicView {
    const current = phaseAt(state, now);
    const questionCount = state.questions.length;
    const board = () => leaderboard(standings(state, closedCount(state, now)));

    switch (current.phase) {
      case "waiting":
        return { phase: "waiting", startsAt: state.startAt, questionCount };
      case "finished":
        return { phase: "finished", questionCount, leaderboard: board() };
      case "question": {
        const question = state.questions[current.index]!;
        let answered = 0;
        for (const answers of state.answers.values()) if (answers[current.index]) answered += 1;
        return {
          phase: "question",
          index: current.index,
          questionCount,
          prompt: question.prompt,
          choices: question.choices,
          opensAt: openAt(state, current.index),
          closesAt: openAt(state, current.index) + state.openMs,
          answered,
          leaderboard: board(),
        };
      }
      case "reveal": {
        const question = state.questions[current.index]!;
        let correctCount = 0;
        for (const answers of state.answers.values()) {
          if (answers[current.index]?.correct) correctCount += 1;
        }
        return {
          phase: "reveal",
          index: current.index,
          questionCount,
          prompt: question.prompt,
          choices: question.choices,
          answer: question.answer,
          correctCount,
          nextAt: openAt(state, current.index + 1),
          leaderboard: board(),
        };
      }
    }
  },

  playerView(state, player, now): QuizPlayerView {
    const closed = closedCount(state, now);
    const answers = (state.answers.get(player) ?? []).flatMap((answer, question) =>
      answer
        ? [{ question, choice: answer.choice, correct: question < closed ? answer.correct : null }]
        : [],
    );
    return { answers, score: tally(state, player, closed).correct };
  },

  rank: (state) => standings(state, state.questions.length),
};

function drawQuestions(bank: QuizBank, count: number, rng: Rng): Question[] {
  const order = rng.shuffle(bank.questions.map((_, i) => i));
  return order.slice(0, count).map((i) => bank.questions[i]!);
}
