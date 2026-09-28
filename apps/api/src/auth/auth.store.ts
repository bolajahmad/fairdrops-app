import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AUTH_LIFETIMES, type Address } from "@fairdrops/shared";
import { Redis } from "ioredis";
import { REDIS } from "../infra/redis.module.js";
import type { AuthContext } from "./auth.types.js";

const keys = {
  nonce: (nonce: string) => `auth:nonce:${nonce}`,
  wsTicket: (ticket: string) => `auth:ws-ticket:${ticket}`,
  revokedSession: (sessionId: string) => `auth:revoked-session:${sessionId}`,
};

/** Short-lived, single-use auth state. Every consume is a GETDEL, so each value works once. */
@Injectable()
export class AuthStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async createNonce(address: Address): Promise<{ nonce: string; expiresAt: Date }> {
    const nonce = randomBytes(16).toString("hex");
    await this.redis.set(keys.nonce(nonce), address, "EX", AUTH_LIFETIMES.nonceSeconds);
    return { nonce, expiresAt: new Date(Date.now() + AUTH_LIFETIMES.nonceSeconds * 1000) };
  }

  /** Returns the address the nonce was issued to, or null if it is unknown, used or expired. */
  async consumeNonce(nonce: string): Promise<string | null> {
    return this.redis.getdel(keys.nonce(nonce));
  }

  async createWsTicket(context: AuthContext): Promise<{ ticket: string; expiresAt: Date }> {
    const ticket = randomBytes(32).toString("base64url");
    await this.redis.set(
      keys.wsTicket(ticket),
      JSON.stringify(context),
      "EX",
      AUTH_LIFETIMES.wsTicketSeconds,
    );
    return { ticket, expiresAt: new Date(Date.now() + AUTH_LIFETIMES.wsTicketSeconds * 1000) };
  }

  async consumeWsTicket(ticket: string): Promise<AuthContext | null> {
    const value = await this.redis.getdel(keys.wsTicket(ticket));
    return value ? (JSON.parse(value) as AuthContext) : null;
  }

  /**
   * Access tokens are stateless, so revoking a session also blocks its outstanding access
   * tokens for the rest of their lifetime.
   */
  async markSessionsRevoked(sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of sessionIds) {
      pipeline.set(keys.revokedSession(id), "1", "EX", AUTH_LIFETIMES.accessTokenSeconds);
    }
    await pipeline.exec();
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(keys.revokedSession(sessionId))) === 1;
  }
}
