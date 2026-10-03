import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  relayQuoteQuerySchema,
  relayRequestSchema,
  uuidSchema,
  type RelayQuote,
  type RelayQuoteQuery,
  type RelayRequest,
  type RelayView,
} from "@fairdrops/shared";
import type { AuthContext } from "../auth/auth.types.js";
import { AuthGuard, CurrentAuth } from "../auth/guards.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RelayService } from "./relay.service.js";

/** Gas-free actions: quote the fee, submit a signed action, and follow it until it's mined. */
@Controller("relay")
export class RelayController {
  constructor(private readonly relay: RelayService) {}

  @Get("quote")
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: "relay-quote", limit: 60, windowSeconds: 60, by: "user" })
  quote(
    @Query(new ZodValidationPipe(relayQuoteQuerySchema)) query: RelayQuoteQuery,
  ): Promise<RelayQuote> {
    return this.relay.quote(query);
  }

  @Post()
  @HttpCode(202)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: "relay-submit", limit: 20, windowSeconds: 60, by: "user" })
  submit(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(relayRequestSchema)) body: RelayRequest,
  ): Promise<RelayView> {
    return this.relay.submit(auth, body);
  }

  /** Public by id (an unguessable UUID), so a page can follow a request without a session. */
  @Get(":id")
  get(@Param("id", new ZodValidationPipe(uuidSchema)) id: string): Promise<RelayView> {
    return this.relay.get(id);
  }
}
