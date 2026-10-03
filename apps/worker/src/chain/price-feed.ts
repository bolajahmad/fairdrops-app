import { Inject, Injectable, Logger } from "@nestjs/common";
import { USD_PEG, pricedIds } from "@fairdrops/shared";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";

const FRESH_MS = 5 * 60_000;

/**
 * USD prices of the coins relay fees are converted through, from the same source as the API's
 * `GET /prices`, cached for five minutes. When the source is down the last prices are kept, and
 * fees for unpriced tokens fall back to a share of the amount.
 */
@Injectable()
export class PriceFeed {
  private readonly logger = new Logger(PriceFeed.name);
  private cached: { prices: Record<string, number>; at: number } | null = null;

  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {}

  async current(now = Date.now()): Promise<Record<string, number>> {
    // Tests never reach the network: only dollar-pegged tokens are priced there.
    if (this.env.NODE_ENV === "test") return { [USD_PEG]: 1 };
    if (!this.cached || now - this.cached.at >= FRESH_MS) {
      try {
        const url = new URL(this.env.PRICE_API_URL);
        url.searchParams.set("ids", pricedIds().join(","));
        url.searchParams.set("vs_currencies", "usd");
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Price source responded ${response.status}`);
        const body = (await response.json()) as Record<string, { usd?: unknown }>;
        const prices: Record<string, number> = {};
        for (const [id, entry] of Object.entries(body)) {
          if (typeof entry.usd === "number" && Number.isFinite(entry.usd)) prices[id] = entry.usd;
        }
        this.cached = { prices, at: now };
      } catch (error) {
        this.logger.warn(`Price fetch failed: ${(error as Error).message}`);
        this.cached ??= { prices: {}, at: now };
      }
    }
    return { ...this.cached.prices, [USD_PEG]: 1 };
  }
}
