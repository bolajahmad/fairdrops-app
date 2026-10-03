import { describe, expect, it } from "vitest";
import { RELAY_GAS, relayFee } from "./relay.js";
import { NATIVE_TOKEN_ADDRESS } from "./tokens.js";

const USDC_BASE = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as const;
const UNVERIFIED = `0x${"1".repeat(40)}` as const;
const base = { chainId: 84532, gas: RELAY_GAS.claim, gasPriceWei: 1_000_000_000n };

describe("relayFee", () => {
  it("converts the gas cost into a priced token, with a margin", () => {
    // 170k gas at 1 gwei = 0.00017 ETH; +30% = 0.000221 ETH; at $2000 that's $0.442 of USDC.
    const fee = relayFee({
      ...base,
      token: USDC_BASE,
      decimals: 6,
      amount: 100_000_000n,
      prices: { ethereum: 2000 },
    });
    expect(fee).toBe(442_000n);
  });

  it("is the gas cost itself when the native coin moves", () => {
    const fee = relayFee({
      ...base,
      token: NATIVE_TOKEN_ADDRESS,
      decimals: 18,
      amount: 10n ** 18n,
      prices: {},
    });
    expect(fee).toBe(221_000_000_000_000n);
  });

  it("takes 1% of an unpriced token, and never more than a tenth of the amount", () => {
    expect(relayFee({ ...base, token: UNVERIFIED, decimals: 18, amount: 1_000n, prices: {} })).toBe(
      10n,
    );
    expect(
      relayFee({
        ...base,
        token: USDC_BASE,
        decimals: 6,
        amount: 1_000_000n,
        prices: { ethereum: 2000 },
      }),
    ).toBe(100_000n);
  });
});
