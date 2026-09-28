import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  AUTH_LIFETIMES,
  nonceRequestSchema,
  refreshRequestSchema,
  verifyRequestSchema,
  type MeResponse,
  type NonceRequest,
  type NonceResponse,
  type RefreshRequest,
  type SessionResponse,
  type TokenTransport,
  type VerifyRequest,
  type WsTicketResponse,
} from "@fairdrops/shared";
import type { Request, Response } from "express";
import { AppException } from "../common/app.exception.js";
import { readCookie } from "../common/cookies.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { API_ENV, type ApiEnv } from "../config/env.js";
import { ProfilesService } from "../profiles/profiles.service.js";
import { AllowedOriginsService } from "./allowed-origins.service.js";
import { AuthService, type IssuedSession } from "./auth.service.js";
import type { AuthContext } from "./auth.types.js";
import { AuthGuard, CurrentAuth } from "./guards.js";

export const REFRESH_COOKIE = "fd_refresh";
const REFRESH_COOKIE_PATH = "/auth";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly auth: AuthService,
    private readonly profiles: ProfilesService,
    private readonly origins: AllowedOriginsService,
  ) {}

  @Post("nonce")
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "auth-nonce", limit: 20, windowSeconds: 60, by: "ip" })
  nonce(
    @Body(new ZodValidationPipe(nonceRequestSchema)) body: NonceRequest,
  ): Promise<NonceResponse> {
    return this.auth.nonce(body.address);
  }

  @Post("verify")
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "auth-verify", limit: 10, windowSeconds: 60, by: "ip" })
  async verify(
    @Body(new ZodValidationPipe(verifyRequestSchema)) body: VerifyRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const issued = await this.auth.signIn(body, request.header("user-agent"));
    return this.deliver(issued, body.transport, response);
  }

  /**
   * Rotates the refresh token. Web clients send the cookie, which is only accepted from a
   * first-party Origin; other clients send the token in the body.
   */
  @Post("refresh")
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "auth-refresh", limit: 30, windowSeconds: 60, by: "ip" })
  async refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    let token = body.refreshToken;
    if (!token) {
      token = readCookie(request, REFRESH_COOKIE);
      if (token && !this.origins.isFirstParty(request.header("origin"))) {
        throw AppException.forbidden("Cookie refresh is only allowed from the FairDrops app");
      }
    }
    if (!token) throw AppException.unauthenticated("No refresh token provided");

    const issued = await this.auth.refresh(token, request.header("user-agent"));
    return this.deliver(issued, body.transport, response);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(auth.sessionId);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    return this.profiles.me(auth.userId, auth.wallet, auth.roles);
  }

  /** A single-use ticket for opening a WebSocket, which cannot carry an Authorization header. */
  @Post("ws-ticket")
  @HttpCode(200)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: "auth-ws-ticket", limit: 30, windowSeconds: 60, by: "user" })
  wsTicket(@CurrentAuth() auth: AuthContext): Promise<WsTicketResponse> {
    return this.auth.wsTicket(auth);
  }

  private deliver(
    issued: IssuedSession,
    transport: TokenTransport,
    response: Response,
  ): SessionResponse {
    if (transport === "body") return { ...issued.response, refreshToken: issued.refreshToken };
    response.cookie(REFRESH_COOKIE, issued.refreshToken, {
      ...this.cookieOptions(),
      maxAge: AUTH_LIFETIMES.refreshTokenSeconds * 1000,
    });
    return issued.response;
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.env.AUTH_COOKIE_SECURE,
      sameSite: "strict" as const,
      path: REFRESH_COOKIE_PATH,
    };
  }
}
