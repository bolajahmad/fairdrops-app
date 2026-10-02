import { describe, expect, it } from "vitest";
import { quizBankSchema } from "../games/quiz.js";
import { hashJson } from "../hash.js";
import { DEFAULT_QUIZ_BANK_HASH, builtinQuizBanks, fairDropsMix } from "./index.js";

describe("built-in quiz banks", () => {
  it("ships a valid 100-question default bank", () => {
    const bank = quizBankSchema.parse(fairDropsMix);
    expect(bank.questions).toHaveLength(100);
    expect(new Set(bank.questions.map((q) => q.prompt)).size).toBe(100);
    expect(DEFAULT_QUIZ_BANK_HASH).toBe(hashJson(fairDropsMix));
    expect(builtinQuizBanks[0]?.hash).toBe(DEFAULT_QUIZ_BANK_HASH);
  });

  it("spreads right answers across positions, so guessing one letter doesn't pay", () => {
    const counts = [0, 0, 0, 0];
    for (const q of fairDropsMix.questions) counts[q.answer]! += 1;
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(20);
  });
});
