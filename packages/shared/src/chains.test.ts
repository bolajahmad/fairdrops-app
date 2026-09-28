import { describe, expect, it } from "vitest";
import {
  chainSchema,
  chains,
  chainsInEnvironment,
  explorerAddressUrl,
  findChain,
  subgraphName,
} from "./chains.js";

describe("chain registry", () => {
  it("contains only valid chains", () => {
    for (const chain of chains) {
      expect(chainSchema.safeParse(chain).success, chain.key).toBe(true);
    }
  });

  it("has unique chain ids and keys", () => {
    expect(new Set(chains.map((c) => c.chainId)).size).toBe(chains.length);
    expect(new Set(chains.map((c) => c.key)).size).toBe(chains.length);
  });

  it("groups chains by environment", () => {
    expect(chainsInEnvironment("testnet").map((c) => c.key)).toEqual([
      "monad-testnet",
      "sepolia",
      "base-sepolia",
      "polkadot-hub-testnet",
    ]);
    expect(chainsInEnvironment("mainnet")).toEqual([]);
  });

  it("names one subgraph per chain Goldsky can index", () => {
    const indexed = chains.filter((c) => c.subgraphNetwork !== null);
    expect(indexed.map((c) => c.key)).toEqual(["monad-testnet", "sepolia", "base-sepolia"]);
    expect(new Set(indexed.map((c) => c.subgraphNetwork)).size).toBe(indexed.length);
    expect(subgraphName(findChain(84532)!)).toBe("fairdrops-base-sepolia");
  });

  it("builds explorer links only for chains with an explorer", () => {
    const address = "0x0000000000000000000000000000000000000001";
    expect(explorerAddressUrl(findChain(84532)!, address)).toBe(
      `https://sepolia.basescan.org/address/${address}`,
    );
    expect(explorerAddressUrl(findChain(31337)!, address)).toBeNull();
    expect(findChain(1)).toBeUndefined();
  });
});
