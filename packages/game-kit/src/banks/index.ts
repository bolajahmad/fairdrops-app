import { hashJson } from "../hash.js";
import { quizBankSchema, type QuizBank } from "../games/quiz.js";
import { fairDropsMix } from "./fairdrops-mix.js";

export { fairDropsMix } from "./fairdrops-mix.js";

/** Question banks FairDrops ships. The worker registers them at start, so quizzes never lack one. */
export const builtinQuizBanks: readonly { bank: QuizBank; hash: `0x${string}` }[] = [
  fairDropsMix,
].map((bank) => ({ bank: quizBankSchema.parse(bank), hash: hashJson(bank) }));

/** The bank a quiz uses when the host doesn't pick one. */
export const DEFAULT_QUIZ_BANK_HASH = builtinQuizBanks[0]!.hash;
