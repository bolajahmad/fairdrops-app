import { Inject, Injectable } from "@nestjs/common";
import { API_ENV, type ApiEnv } from "../config/env.js";

export const PRICE_SOURCE = Symbol("PRICE_SOURCE");

/** US dollar prices by price id. Ids the source doesn't know are left out. */
export interface PriceSource {
  fetch(ids: readonly string[]): Promise<Record<string, number>>;
}

/** CoinGecko's public `simple/price`: no key needed, rate limited per IP, so callers cache. */
@Injectable()
export class CoinGeckoPriceSource implements PriceSource {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  async fetch(ids: readonly string[]): Promise<Record<string, number>> {
    const url = new URL(this.env.PRICE_API_URL);
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("vs_currencies", "usd");
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Price source responded ${response.status}`);
    const body = (await response.json()) as Record<string, { usd?: unknown }>;
    const prices: Record<string, number> = {};
    for (const id of ids) {
      const usd = body[id]?.usd;
      if (typeof usd === "number" && Number.isFinite(usd) && usd >= 0) prices[id] = usd;
    }
    return prices;
  }
}
