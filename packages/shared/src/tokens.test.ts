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
    expect(usdc).toMatchObject({ approved: true, trust: "verified", native: false, warning: null });

    const unknown = toTokenView({
      chainId: 11155111,
      address: "0x000000000000000000000000000000000000dead",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    });
    // Same symbol as the listed USDC on Sepolia: a lookalike, with a pointed warning.
    expect(unknown).toMatchObject({ approved: false, trust: "unverified" });
    expect(unknown.warning).toContain("0x1c7d4b196cb0c7b01d743fbc6116a902379c7238");

    const other = toTokenView({
      chainId: 11155111,
      address: "0x000000000000000000000000000000000000beef",
      symbol: "HUSDC",
      name: "Hello USD",
      decimals: 6,
    });
    expect(other).toMatchObject({ trust: "unverified", warning: UNAPPROVED_TOKEN_WARNING });
    expect(
      toTokenView({ ...other, address: "0x000000000000000000000000000000000000beef" }, true).trust,
    ).toBe("listed");
  });

  it("verifies the test tokens added for the Sepolia and Base Sepolia demos", () => {
    expect(findApprovedToken(11155111, "0xd077A400968890Eacc75cdc901F0356c943e4fDb")).toMatchObject(
      {
        symbol: "USD₮",
        decimals: 6,
      },
    );
    expect(findApprovedToken(84532, "0x52B6df3c98225F040b9B89A07180E7Bc6ba34f87")).toMatchObject({
      symbol: "MNEE",
      decimals: 18,
    });
    // Same address on both chains, two separate tokens.
    for (const chainId of [11155111, 84532]) {
      expect(findApprovedToken(chainId, "0xA801da100bF16D07F668F4A49E1f71fc54D05177")?.symbol).toBe(
        "USD.h",
      );
    }
  });

  it("stores addresses lowercased", () => {
    const view = toTokenView({
      chainId: 84532,
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      symbol: "USDC",
      name: "USDC",
      decimals: 6,
    });
    expect(view).toMatchObject({
      address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      trust: "verified",
    });
  });
});
