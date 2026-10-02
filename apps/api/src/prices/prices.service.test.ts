import { describe, expect, it } from "vitest";
import type { PriceSource } from "./price-source.js";
import { PricesService } from "./prices.service.js";

function source(): PriceSource & { calls: number; fail: boolean } {
  const fake = {
    calls: 0,
    fail: false,
    fetch(ids: readonly string[]): Promise<Record<string, number>> {
      fake.calls += 1;
      if (fake.fail) return Promise.reject(new Error("down"));
      const prices: Record<string, number> = ids.includes("ethereum") ? { ethereum: 2000 } : {};
      return Promise.resolve(prices);
    },
  };
  return fake;
}

describe("PricesService", () => {
  it("fetches once per five minutes, sharing a fetch between concurrent requests", async () => {
    const fake = source();
    const service = new PricesService(fake);
    const [first] = await Promise.all([service.current(0), service.current(0)]);
    expect(first.prices).toEqual({ ethereum: 2000, usd: 1 });
    await service.current(4 * 60_000);
    expect(fake.calls).toBe(1);
    await service.current(5 * 60_000);
    expect(fake.calls).toBe(2);
  });

  it("keeps serving the last prices while the source is down, and backs off", async () => {
    const fake = source();
    const service = new PricesService(fake);
    await service.current(0);
    fake.fail = true;
    const stale = await service.current(10 * 60_000);
    expect(stale.prices.ethereum).toBe(2000);
    await service.current(10 * 60_000 + 30_000);
    expect(fake.calls).toBe(2);
  });

  it("prices dollar-pegged tokens even before the first fetch succeeds", async () => {
    const fake = source();
    fake.fail = true;
    const body = await new PricesService(fake).current(0);
    expect(body).toEqual({ currency: "USDT", prices: { usd: 1 }, updatedAt: null });
  });
});
