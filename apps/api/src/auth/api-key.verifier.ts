import { Inject, Injectable } from "@nestjs/common";
import { apiKeyScopeSchema, type ApiKeyIdentity } from "@fairdrops/shared";
import { AppException } from "../common/app.exception.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { apiKeyMatches, parseApiKeyPrefix } from "./api-key.js";

const LAST_USED_RESOLUTION_MS = 60_000;

@Injectable()
export class ApiKeyVerifier {
  constructor(@Inject(PRISMA) private readonly db: Database) {}

  async verify(key: string): Promise<ApiKeyIdentity> {
    const prefix = parseApiKeyPrefix(key);
    const record = prefix ? await this.db.apiKey.findUnique({ where: { prefix } }) : null;
    const now = new Date();
    if (
      !record ||
      !apiKeyMatches(key, record.secretHash) ||
      record.revokedAt ||
      (record.expiresAt && record.expiresAt <= now)
    ) {
      throw AppException.unauthenticated("API key is invalid, revoked or expired");
    }

    // Recorded at most once a minute, so busy keys do not write on every request.
    await this.db.apiKey.updateMany({
      where: {
        id: record.id,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_RESOLUTION_MS) } },
        ],
      },
      data: { lastUsedAt: now },
    });

    return {
      keyId: record.id,
      ownerId: record.userId,
      scopes: record.scopes.map((s) => apiKeyScopeSchema.parse(s)),
    };
  }
}
