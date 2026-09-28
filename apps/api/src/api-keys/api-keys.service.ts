import { Inject, Injectable } from "@nestjs/common";
import type { ApiKey } from "@fairdrops/db";
import {
  apiKeyScopeSchema,
  type ApiKeyView,
  type CreateApiKeyRequest,
  type CreatedApiKey,
} from "@fairdrops/shared";
import { generateApiKey } from "../auth/api-key.js";
import { AppException } from "../common/app.exception.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";

const MAX_ACTIVE_KEYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function toView(key: ApiKey): ApiKeyView {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes.map((s) => apiKeyScopeSchema.parse(s)),
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ApiKeysService {
  constructor(@Inject(PRISMA) private readonly db: Database) {}

  async create(userId: string, body: CreateApiKeyRequest): Promise<CreatedApiKey> {
    const now = new Date();
    const active = await this.db.apiKey.count({
      where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    if (active >= MAX_ACTIVE_KEYS) {
      throw AppException.conflict(`You can have at most ${MAX_ACTIVE_KEYS} active API keys`);
    }

    const generated = generateApiKey();
    const key = await this.db.apiKey.create({
      data: {
        userId,
        name: body.name,
        prefix: generated.prefix,
        secretHash: generated.hash,
        scopes: body.scopes,
        expiresAt: body.expiresInDays
          ? new Date(now.getTime() + body.expiresInDays * DAY_MS)
          : null,
      },
    });
    return { ...toView(key), secret: generated.secret };
  }

  async list(userId: string): Promise<ApiKeyView[]> {
    const keys = await this.db.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return keys.map(toView);
  }

  async revoke(userId: string, id: string): Promise<ApiKeyView> {
    await this.db.apiKey.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const key = await this.db.apiKey.findFirst({ where: { id, userId } });
    if (!key) throw AppException.notFound("API key not found");
    return toView(key);
  }
}
