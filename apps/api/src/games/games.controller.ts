import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  createGameDefinitionRequestSchema,
  gameDefinitionListQuerySchema,
  gameIdSchema,
  reviewGameDefinitionRequestSchema,
  semverSchema,
  updateGameDefinitionRequestSchema,
  type CreateGameDefinitionRequest,
  type GameDefinitionListQuery,
  type GameDefinitionView,
  type Page,
  type ReviewGameDefinitionRequest,
  type UpdateGameDefinitionRequest,
} from "@fairdrops/shared";
import type { AuthContext } from "../auth/auth.types.js";
import {
  AdminGuard,
  AuthGuard,
  CurrentAuth,
  MaybeAuth,
  OptionalAuthGuard,
} from "../auth/guards.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { GamesService } from "./games.service.js";

const idPipe = new ZodValidationPipe(gameIdSchema);
const versionPipe = new ZodValidationPipe(semverSchema);
const reviewPipe = new ZodValidationPipe(reviewGameDefinitionRequestSchema);
const listPipe = new ZodValidationPipe(gameDefinitionListQuerySchema);

@Controller("games")
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Post()
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: "game-write", limit: 30, windowSeconds: 60, by: "user" })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createGameDefinitionRequestSchema))
    body: CreateGameDefinitionRequest,
  ): Promise<GameDefinitionView> {
    return this.games.create(auth.userId, body);
  }

  @Get()
  @UseGuards(OptionalAuthGuard)
  list(
    @MaybeAuth() auth: AuthContext | undefined,
    @Query(listPipe) query: GameDefinitionListQuery,
  ): Promise<Page<GameDefinitionView>> {
    return this.games.list(query, auth);
  }

  @Get("review-queue")
  @UseGuards(AuthGuard, AdminGuard)
  reviewQueue(@Query(listPipe) query: GameDefinitionListQuery): Promise<Page<GameDefinitionView>> {
    return this.games.reviewQueue(query);
  }

  @Get(":id/:version")
  @UseGuards(OptionalAuthGuard)
  get(
    @MaybeAuth() auth: AuthContext | undefined,
    @Param("id", idPipe) id: string,
    @Param("version", versionPipe) version: string,
  ): Promise<GameDefinitionView> {
    return this.games.get({ id, version }, auth);
  }

  @Patch(":id/:version")
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: "game-write", limit: 30, windowSeconds: 60, by: "user" })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("id", idPipe) id: string,
    @Param("version", versionPipe) version: string,
    @Body(new ZodValidationPipe(updateGameDefinitionRequestSchema))
    body: UpdateGameDefinitionRequest,
  ): Promise<GameDefinitionView> {
    return this.games.update(auth, { id, version }, body);
  }

  @Post(":id/:version/submit")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  submit(
    @CurrentAuth() auth: AuthContext,
    @Param("id", idPipe) id: string,
    @Param("version", versionPipe) version: string,
  ): Promise<GameDefinitionView> {
    return this.games.submit(auth, { id, version });
  }

  @Post(":id/:version/approve")
  @HttpCode(200)
  @UseGuards(AuthGuard, AdminGuard)
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param("id", idPipe) id: string,
    @Param("version", versionPipe) version: string,
    @Body(reviewPipe) body: ReviewGameDefinitionRequest,
  ): Promise<GameDefinitionView> {
    return this.games.approve(auth, { id, version }, body.note);
  }

  @Post(":id/:version/reject")
  @HttpCode(200)
  @UseGuards(AuthGuard, AdminGuard)
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param("id", idPipe) id: string,
    @Param("version", versionPipe) version: string,
    @Body(reviewPipe) body: ReviewGameDefinitionRequest,
  ): Promise<GameDefinitionView> {
    return this.games.reject(auth, { id, version }, body.note);
  }

  @Post(":id/:version/disable")
  @HttpCode(200)
  @UseGuards(AuthGuard, AdminGuard)
  disable(
    @CurrentAuth() auth: AuthContext,
    @Param("id", idPipe) id: string,
    @Param("version", versionPipe) version: string,
    @Body(reviewPipe) body: ReviewGameDefinitionRequest,
  ): Promise<GameDefinitionView> {
    return this.games.disable(auth, { id, version }, body.note);
  }
}
