import { Controller, Get, UseGuards } from "@nestjs/common";
import type { PricesResponse } from "@fairdrops/shared";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { PricesService } from "./prices.service.js";

/** Public: approximate USDT prices of verified tokens, for totals and summaries. */
@Controller("prices")
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "prices", limit: 120, windowSeconds: 60, by: "ip" })
  current(): Promise<PricesResponse> {
    return this.prices.current();
  }
}
