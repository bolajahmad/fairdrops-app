import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  createApiKeyRequestSchema,
  uuidSchema,
  type ApiKeyIdentity,
  type ApiKeyView,
  type CreateApiKeyRequest,
  type CreatedApiKey,
} from "@fairdrops/shared";
import type { Request } from "express";
import type { AuthContext } from "../auth/auth.types.js";
import { ApiKeyGuard, AuthGuard, CurrentAuth } from "../auth/guards.js";
import { AppException } from "../common/app.exception.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ApiKeysService } from "./api-keys.service.js";

@Controller("api-keys")
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Post()
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: "api-key-create", limit: 10, windowSeconds: 60, by: "user" })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createApiKeyRequestSchema)) body: CreateApiKeyRequest,
  ): Promise<CreatedApiKey> {
    return this.keys.create(auth.userId, body);
  }

  @Get()
  @UseGuards(AuthGuard)
  list(@CurrentAuth() auth: AuthContext): Promise<ApiKeyView[]> {
    return this.keys.list(auth.userId);
  }

  /** Lets a game server confirm its key works and see its scopes. */
  @Get("whoami")
  @UseGuards(ApiKeyGuard)
  whoami(@Req() request: Request): ApiKeyIdentity {
    if (!request.apiKey) throw AppException.unauthenticated();
    return request.apiKey;
  }

  @Delete(":id")
  @UseGuards(AuthGuard)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<ApiKeyView> {
    return this.keys.revoke(auth.userId, id);
  }
}
