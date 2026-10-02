import { Controller, Get, UseGuards } from "@nestjs/common";
import type { LeaderboardsView } from "@fairdrops/shared";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { LeaderboardsService } from "./leaderboards.service.js";

/** Public: the top winners and hosts shown on Discover. */
@Controller("leaderboards")
export class LeaderboardsController {
  constructor(private readonly leaderboards: LeaderboardsService) {}

  @Get()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "leaderboards", limit: 120, windowSeconds: 60, by: "ip" })
  current(): Promise<LeaderboardsView> {
    return this.leaderboards.current();
  }
}
