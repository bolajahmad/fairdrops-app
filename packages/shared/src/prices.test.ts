import { describe, expect, it } from "vitest";
import { USD_PEG, priceIdOf, referenceValue } from "./prices.js";
import { NATIVE_TOKEN_ADDRESS } from "./tokens.js";

const USDC_BASE = { chainId: 84532, address: "0x036CBD53842c5426634e7929541eC2318f3dCF7e" };

describe("priceIdOf", () => {
  it("prices verified stablecoins at the dollar peg and native coins by their mainnet coin", () => {
    expect(priceIdOf(USDC_BASE)).toBe(USD_PEG);
    expect(priceIdOf({ chainId: 11155111, address: NATIVE_TOKEN_ADDRESS })).toBe("ethereum");
    expect(priceIdOf({ chainId: 10143, address: NATIVE_TOKEN_ADDRESS })).toBe("monad");
  });

  it("never prices an unverified token, even one named like a stablecoin", () => {
    expect(priceIdOf({ chainId: 84532, address: `0x${"1".repeat(40)}` })).toBeNull();
  });
});

describe("referenceValue", () => {
  it("converts smallest units with the token's decimals", () => {
    expect(referenceValue(USDC_BASE, 12_500_000n, 6, {})).toBe(12.5);
    expect(
      referenceValue({ chainId: 84532, address: NATIVE_TOKEN_ADDRESS }, "500000000000000000", 18, {
        ethereum: 2000,
      }),
    ).toBe(1000);
  });

  it("is null when the market price is missing", () => {
    expect(
      referenceValue({ chainId: 84532, address: NATIVE_TOKEN_ADDRESS }, 1n, 18, {}),
    ).toBeNull();
  });
});
