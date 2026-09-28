import { Inject, Injectable } from "@nestjs/common";
import { API_ENV, type ApiEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";

const GAME_ORIGINS_TTL_MS = 60_000;

/**
 * Origins that may ask users to sign in: the first-party apps from configuration, plus the UI
 * origin of every approved game, so third-party game UIs can sign players in directly.
 */
@Injectable()
export class AllowedOriginsService {
  private gameOrigins: { origins: Set<string>; loadedAt: number } | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PRISMA) private readonly db: Database,
  ) {}

  isFirstParty(origin: string | undefined): boolean {
    return origin !== undefined && this.env.APP_ORIGINS.includes(origin);
  }

  async isAllowed(origin: string): Promise<boolean> {
    if (this.isFirstParty(origin)) return true;
    return (await this.loadGameOrigins()).has(origin);
  }

  /** Forgets cached game origins, e.g. after a game is approved or disabled. */
  invalidate(): void {
    this.gameOrigins = null;
  }

  private async loadGameOrigins(): Promise<Set<string>> {
    if (this.gameOrigins && Date.now() - this.gameOrigins.loadedAt < GAME_ORIGINS_TTL_MS) {
      return this.gameOrigins.origins;
    }
    const games = await this.db.gameDefinition.findMany({
      where: { status: "APPROVED", uiUrl: { not: null } },
      select: { uiUrl: true },
    });
    const origins = new Set(games.flatMap((g) => (g.uiUrl ? [new URL(g.uiUrl).origin] : [])));
    this.gameOrigins = { origins, loadedAt: Date.now() };
    return origins;
  }
}
