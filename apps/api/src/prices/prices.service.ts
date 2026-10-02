import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRICE_CURRENCY, USD_PEG, pricedIds, type PricesResponse } from "@fairdrops/shared";
import { PRICE_SOURCE, type PriceSource } from "./price-source.js";

/** Market prices move slowly next to a dashboard; five minutes keeps us far under rate limits. */
const FRESH_MS = 5 * 60_000;
/** After a failed fetch, wait this long before trying again, serving the last prices meanwhile. */
const RETRY_MS = 60_000;

/**
 * Approximate USDT prices for verified tokens, for display only. One fetch serves every
 * request for five minutes; when the source is down, the last good prices are served, and
 * dollar-pegged tokens are always priced.
 */
@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);
  private cached: { prices: Record<string, number>; fetchedAt: number } | null = null;
  private nextAttempt = 0;
  private inflight: Promise<void> | null = null;

  constructor(@Inject(PRICE_SOURCE) private readonly source: PriceSource) {}

  async current(now = Date.now()): Promise<PricesResponse> {
    const stale = !this.cached || now - this.cached.fetchedAt >= FRESH_MS;
    if (stale && now >= this.nextAttempt) {
      this.inflight ??= this.refresh(now).finally(() => {
        this.inflight = null;
      });
      await this.inflight;
    }
    return {
      currency: PRICE_CURRENCY,
      prices: { ...this.cached?.prices, [USD_PEG]: 1 },
      updatedAt: this.cached ? new Date(this.cached.fetchedAt).toISOString() : null,
    };
  }

  private async refresh(now: number): Promise<void> {
    try {
      this.cached = { prices: await this.source.fetch(pricedIds()), fetchedAt: now };
    } catch (error) {
      this.nextAttempt = now + RETRY_MS;
      this.logger.warn(
        `Price fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
