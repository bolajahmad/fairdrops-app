import { describe, expect, it } from "vitest";
import { chains } from "./chains.js";
import {
  NATIVE_TOKEN_ADDRESS,
  UNAPPROVED_TOKEN_WARNING,
  approvedTokens,
  findApprovedToken,
  toTokenView,
  tokenSchema,
} from "./tokens.js";

describe("tokens", () => {
  it("approves the native currency of every chain", () => {
    for (const chain of chains) {
      expect(findApprovedToken(chain.chainId, NATIVE_TOKEN_ADDRESS)?.symbol).toBe(
        chain.nativeCurrency.symbol,
      );
    }
  });

  it("lists only valid, unique tokens", () => {
    for (const token of approvedTokens) expect(tokenSchema.parse(token)).toEqual(token);
    const keys = approvedTokens.map((t) => `${t.chainId}:${t.address}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("matches approved tokens regardless of address case", () => {
    expect(findApprovedToken(84532, "0x036CbD53842c5426634e7929541eC2318f3dCF7e")).toBeDefined();
  });

  it("always attaches a warning to tokens outside the approved list", () => {
    const usdc = toTokenView(
      findApprovedToken(11155111, "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238")!,
    );
    expect(usdc).toMatchObject({ approved: true, native: false, warning: null });

    const unknown = toTokenView({
      chainId: 11155111,
      address: "0x000000000000000000000000000000000000dead",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    });
    expect(unknown).toMatchObject({ approved: false, warning: UNAPPROVED_TOKEN_WARNING });
  });
});
