import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

const CHAIN_MISMATCH = `The current chain of the wallet (id: 10143) does not match the target chain for the transaction (id: 11155111 – Sepolia). Current Chain ID: 10143 Expected Chain ID: 11155111 – Sepolia Request Arguments: chain: Sepolia (id: 11155111) from: 0x9281e0888a4b6e7360f739be740c0e696c3ced2c data: 0x095ea7b3 Docs: https://viem.sh/docs/contract/writeContract Version: viem@2.56.8`;

describe("friendlyError", () => {
  it("names both networks on a chain mismatch, without the request dump", () => {
    const message = friendlyError(new Error(CHAIN_MISMATCH));
    expect(message).toBe(
      "Your wallet is on Monad Testnet, but this needs Sepolia. Switch networks in your wallet and try again.",
    );
  });

  it("explains a declined network switch instead of a plain cancel", () => {
    const declined = Object.assign(
      new Error(
        "Your wallet needs to be on Sepolia to do this. Approve the network switch, then try again.",
      ),
      { name: "ChainSwitchError", code: 4001 },
    );
    expect(friendlyError(declined)).toMatch(/needs to be on Sepolia/);
  });

  it("recognises a rejection anywhere in the cause chain", () => {
    const inner = Object.assign(new Error("User rejected the request."), { code: 4001 });
    expect(friendlyError(new Error("ContractFunctionExecutionError", { cause: inner }))).toBe(
      "You cancelled in your wallet. Nothing was sent.",
    );
  });

  it("prefers viem's short message and drops its tails", () => {
    const error = Object.assign(new Error("long"), {
      shortMessage: "Execution reverted for an unknown reason",
    });
    expect(friendlyError(error)).toBe("Execution reverted for an unknown reason.");
  });

  it("explains network failures", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/couldn't reach FairDrops/);
  });

  it("clips very long messages", () => {
    const message = friendlyError(new Error("x".repeat(500)));
    expect(message.length).toBeLessThanOrEqual(180);
  });

  it("falls back when there is nothing useful", () => {
    expect(friendlyError(undefined, "Could not join.")).toBe("Could not join.");
  });
});
