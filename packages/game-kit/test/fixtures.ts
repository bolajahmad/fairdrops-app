import type { Address, Hex } from "@fairdrops/shared";
import { hashJson } from "../src/hash.js";
import type { QuizBank } from "../src/games/quiz.js";

export const SEED: Hex = `0x${"5e".repeat(32)}`;
export const START = 1_790_000_000_000;

export const ALICE = "0x00000000000000000000000000000000000000a1" as Address;
export const BOB = "0x00000000000000000000000000000000000000b2" as Address;
export const CAROL = "0x00000000000000000000000000000000000000c3" as Address;

export const bank: QuizBank = {
  v: 1,
  name: "Sample",
  questions: Array.from({ length: 12 }, (_, i) => ({
    prompt: `Question ${i}`,
    choices: ["A", "B", "C", "D"],
    answer: i % 4,
  })),
};
export const BANK_HASH = hashJson(bank);
