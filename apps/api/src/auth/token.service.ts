import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { AUTH_LIFETIMES, accessTokenClaimsSchema, type AccessTokenClaims } from "@fairdrops/shared";
import {
  type CryptoKey,
  type JWK,
  SignJWT,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
} from "jose";
import { API_ENV, type ApiEnv } from "../config/env.js";
import { AppException } from "../common/app.exception.js";
import type { AuthContext } from "./auth.types.js";

const ALGORITHM = "ES256";

interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JWK;
}

/** Issues and verifies access tokens, and publishes the verification key as a JWKS. */
@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger("TokenService");
  private key!: SigningKey;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  async onModuleInit(): Promise<void> {
    this.key = this.env.AUTH_JWT_PRIVATE_JWK
      ? await importSigningKey(this.env.AUTH_JWT_PRIVATE_JWK)
      : await this.generateEphemeralKey();
  }

  async issue(context: AuthContext): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + AUTH_LIFETIMES.accessTokenSeconds * 1000);
    const token = await new SignJWT({
      wal: context.wallet,
      sid: context.sessionId,
      roles: context.roles,
    })
      .setProtectedHeader({ alg: ALGORITHM, kid: this.key.kid, typ: "at+jwt" })
      .setSubject(context.userId)
      .setIssuer(this.env.AUTH_ISSUER)
      .setAudience(this.env.AUTH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key.privateKey);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key.publicKey, {
        issuer: this.env.AUTH_ISSUER,
        audience: this.env.AUTH_AUDIENCE,
        algorithms: [ALGORITHM],
        typ: "at+jwt",
      });
      return accessTokenClaimsSchema.parse(payload);
    } catch {
      throw AppException.unauthenticated("Access token is invalid or expired");
    }
  }

  jwks(): { keys: JWK[] } {
    return { keys: [{ ...this.key.publicJwk, kid: this.key.kid, alg: ALGORITHM, use: "sig" }] };
  }

  private async generateEphemeralKey(): Promise<SigningKey> {
    this.logger.warn(
      "AUTH_JWT_PRIVATE_JWK is not set; using a key generated for this process. " +
        "Tokens will not survive a restart or work across instances.",
    );
    const { privateKey, publicKey } = await generateKeyPair(ALGORITHM, { extractable: true });
    return {
      kid: `ephemeral-${randomUUID()}`,
      privateKey,
      publicKey,
      publicJwk: await exportJWK(publicKey),
    };
  }
}

async function importSigningKey(serialized: string): Promise<SigningKey> {
  const jwk = JSON.parse(serialized) as JWK;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid) {
    throw new Error("AUTH_JWT_PRIVATE_JWK must be a P-256 private JWK with a kid");
  }
  const { d: _private, ...publicJwk } = jwk;
  const privateKey = await importJWK(jwk, ALGORITHM);
  const publicKey = await importJWK(publicJwk, ALGORITHM);
  if (privateKey instanceof Uint8Array || publicKey instanceof Uint8Array) {
    throw new Error("AUTH_JWT_PRIVATE_JWK is not an asymmetric key");
  }
  return { kid: jwk.kid, privateKey, publicKey, publicJwk };
}
