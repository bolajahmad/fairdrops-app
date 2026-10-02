import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  bytes32Schema,
  chainIdSchema,
  paginationQuerySchema,
  scoreReportRequestSchema,
  uuidSchema,
  type Hex,
  type MembershipView,
  type Page,
  type PaginationQuery,
  type ParticipantView,
  type ScoreReportRequest,
  type SessionView,
} from "@fairdrops/shared";
import type { Request } from "express";
import type { AuthContext } from "../auth/auth.types.js";
import { ApiKeyGuard, AuthGuard, CurrentAuth, RequireScopes } from "../auth/guards.js";
import { AppException } from "../common/app.exception.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SessionsService } from "./sessions.service.js";

const idPipe = new ZodValidationPipe(uuidSchema);

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get("by-giveaway/:chainId/:giveawayId")
  byGiveaway(
    @Param("chainId", new ZodValidationPipe(chainIdSchema)) chainId: number,
    @Param("giveawayId", new ZodValidationPipe(bytes32Schema)) giveawayId: Hex,
  ): Promise<SessionView> {
    return this.sessions.byGiveaway(chainId, giveawayId);
  }

  @Get(":id")
  get(@Param("id", idPipe) id: string): Promise<SessionView> {
    return this.sessions.get(id);
  }

  @Get(":id/participants")
  participants(
    @Param("id", idPipe) id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Page<ParticipantView>> {
    return this.sessions.participants(id, query);
  }

  /** Whether the signed-in wallet is in this game, so the app can go straight to the lobby. */
  @Get(":id/me")
  @UseGuards(AuthGuard)
  membership(
    @CurrentAuth() auth: AuthContext,
    @Param("id", idPipe) id: string,
  ): Promise<MembershipView> {
    return this.sessions.membership(auth, id);
  }

  @Post(":id/join")
  @HttpCode(200)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: "session-join", limit: 30, windowSeconds: 60, by: "user" })
  join(
    @CurrentAuth() auth: AuthContext,
    @Param("id", idPipe) id: string,
  ): Promise<ParticipantView> {
    return this.sessions.join(auth, id);
  }

  /** Everything needed to check the result, published once the game is over. */
  @Get(":id/transcript")
  transcript(@Param("id", idPipe) id: string): Promise<unknown> {
    return this.sessions.transcript(id);
  }

  /** An external game's server reports the final standings. */
  @Post(":id/score-report")
  @HttpCode(202)
  @UseGuards(ApiKeyGuard)
  @RequireScopes("scores:write")
  report(
    @Req() request: Request,
    @Param("id", idPipe) id: string,
    @Body(new ZodValidationPipe(scoreReportRequestSchema)) body: ScoreReportRequest,
  ): Promise<SessionView> {
    if (!request.apiKey) throw AppException.unauthenticated();
    return this.sessions.report(request.apiKey, id, body);
  }
}
