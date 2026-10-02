import { Controller, Get, UseGuards } from "@nestjs/common";
import type { QuizBankView } from "@fairdrops/shared";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { GameResourcesService } from "./game-resources.service.js";

/**
 * Public: hosts pick a question bank when they set up a quiz, before they sign in. Only names
 * and sizes; the questions stay private until a game that used the bank is over.
 */
@Controller("quiz-banks")
export class QuizBanksController {
  constructor(private readonly resources: GameResourcesService) {}

  @Get()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "quiz-banks", limit: 60, windowSeconds: 60, by: "ip" })
  list(): Promise<QuizBankView[]> {
    return this.resources.quizBanks();
  }
}
