import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import {
  createGameResourceRequestSchema,
  gameIdSchema,
  type CreateGameResourceRequest,
  type GameResourceView,
} from "@fairdrops/shared";
import type { AuthContext } from "../auth/auth.types.js";
import { AdminGuard, AuthGuard, CurrentAuth } from "../auth/guards.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { GameResourcesService } from "./game-resources.service.js";

/**
 * Admin-only for now: whoever writes a question bank knows its answers, so hosts cannot supply
 * their own for giveaways they fund.
 */
@Controller("game-resources")
@UseGuards(AuthGuard, AdminGuard)
export class GameResourcesController {
  constructor(private readonly resources: GameResourcesService) {}

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createGameResourceRequestSchema)) body: CreateGameResourceRequest,
  ): Promise<GameResourceView> {
    return this.resources.create(auth.userId, body);
  }

  @Get()
  list(
    @Query("kind", new ZodValidationPipe(gameIdSchema.optional())) kind?: string,
  ): Promise<GameResourceView[]> {
    return this.resources.list(kind);
  }
}
