import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  AUTH_LIFETIMES,
  SIGN_IN_STATEMENT,
  type Address,
  type NonceResponse,
  type SessionResponse,
  type VerifyRequest,
  type WalletConnector,
  type WsTicketResponse,
} from "@fairdrops/shared";
import { AppException } from "../common/app.exception.js";
import { isUniqueViolation } from "../common/prisma-errors.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { ProfilesService } from "../profiles/profiles.service.js";
import { AuthStore } from "./auth.store.js";
import type { AuthContext } from "./auth.types.js";
import { RolesService } from "./roles.service.js";
import { SiweService, type VerifiedWallet } from "./siwe.service.js";
import { TokenService } from "./token.service.js";

/**
 * A second refresh with an already rotated token inside this window is treated as a race
 * between two tabs, not as theft, and does not revoke the session family.
 */
const ROTATION_GRACE_MS = 10_000;

export interface IssuedSession {
  response: SessionResponse;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly db: Database,
    private readonly siwe: SiweService,
    private readonly store: AuthStore,
    private readonly tokens: TokenService,
    private readonly roles: RolesService,
    private readonly profiles: ProfilesService,
  ) {}

  async nonce(address: Address): Promise<NonceResponse> {
    const { nonce, expiresAt } = await this.store.createNonce(address);
    return { nonce, expiresAt: expiresAt.toISOString() };
  }

  async signIn(body: VerifyRequest, userAgent: string | undefined): Promise<IssuedSession> {
    const wallet = await this.siwe.verify(body.message, body.signature, SIGN_IN_STATEMENT);
    const userId = await this.findOrCreateUser(wallet, body.connector);
    return this.startSession({ userId, wallet: wallet.address, familyId: randomUUID(), userAgent });
  }

  async refresh(refreshToken: string, userAgent: string | undefined): Promise<IssuedSession> {
    const session = await this.db.authSession.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
    });
    if (!session) throw AppException.unauthenticated("Refresh token is not recognized");

    if (session.revokedAt) {
      const withinGrace =
        session.revokedReason === "rotated" &&
        Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!withinGrace && session.revokedReason === "rotated")
        await this.revokeFamily(session.familyId);
      throw AppException.unauthenticated("Refresh token has already been used");
    }
    if (session.expiresAt <= new Date()) throw AppException.unauthenticated("Session has expired");

    // Only one caller can rotate a given token; a concurrent loser sees count 0.
    const rotated = await this.db.authSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "rotated", lastUsedAt: new Date() },
    });
    if (rotated.count === 0)
      throw AppException.unauthenticated("Refresh token has already been used");

    return this.startSession({
      userId: session.userId,
      wallet: session.walletAddress as Address,
      familyId: session.familyId,
      userAgent,
    });
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "logout" },
    });
    await this.store.markSessionsRevoked([sessionId]);
  }

  async wsTicket(auth: AuthContext): Promise<WsTicketResponse> {
    const { ticket, expiresAt } = await this.store.createWsTicket(auth);
    return { ticket, expiresAt: expiresAt.toISOString() };
  }

  /** Signs out every session descended from one sign-in, used when a stolen token is replayed. */
  private async revokeFamily(familyId: string): Promise<void> {
    const sessions = await this.db.authSession.findMany({
      where: { familyId, revokedAt: null },
      select: { id: true },
    });
    await this.db.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "reuse-detected" },
    });
    await this.store.markSessionsRevoked(sessions.map((s) => s.id));
  }

  private async findOrCreateUser(
    wallet: VerifiedWallet,
    connector: WalletConnector,
  ): Promise<string> {
    const now = new Date();
    const existing = await this.db.wallet.findUnique({ where: { address: wallet.address } });
    if (existing) {
      await this.db.wallet.update({
        where: { address: wallet.address },
        data: { lastSignInAt: now, kind: wallet.kind, connector: existing.connector ?? connector },
      });
      return existing.userId;
    }

    try {
      const user = await this.db.user.create({
        data: {
          wallets: {
            create: { address: wallet.address, kind: wallet.kind, connector, lastSignInAt: now },
          },
        },
      });
      return user.id;
    } catch (error) {
      // Two first sign-ins for the same wallet raced; the other one created the account.
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.db.wallet.findUniqueOrThrow({ where: { address: wallet.address } });
      return winner.userId;
    }
  }

  private async startSession(input: {
    userId: string;
    wallet: Address;
    familyId: string;
    userAgent: string | undefined;
  }): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshExpiresAt = new Date(Date.now() + AUTH_LIFETIMES.refreshTokenSeconds * 1000);
    const session = await this.db.authSession.create({
      data: {
        familyId: input.familyId,
        userId: input.userId,
        walletAddress: input.wallet,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: input.userAgent?.slice(0, 300),
      },
    });

    const roles = await this.roles.rolesFor(input.wallet);
    const context: AuthContext = {
      userId: input.userId,
      wallet: input.wallet,
      sessionId: session.id,
      roles,
    };
    const access = await this.tokens.issue(context);
    const me = await this.profiles.me(input.userId, input.wallet, roles);

    return {
      refreshToken,
      response: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
        me,
      },
    };
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
