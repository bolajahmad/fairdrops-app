import { NATIVE_TOKEN_ADDRESS, decodeGiveawayMetadata } from "@fairdrops/shared";
import { describe, expect, it } from "vitest";
import type { PublicClient, WalletClient } from "viem";
import {
  InvalidGiveawayError,
  createGiveaway,
  prepareGiveaway,
  type CreateGiveawayInput,
  type CreateProgress,
} from "../src/host.js";

const now = new Date("2026-10-01T12:00:00Z");
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

const input: CreateGiveawayInput = {
  chainId: 84532,
  token: NATIVE_TOKEN_ADDRESS,
  amount: 10n ** 16n,
  startTime: minutes(10),
  finalizeDeadline: minutes(60),
  maxWinners: 3,
  metadata: {
    v: 2,
    title: "Dice night",
    description: "Highest total wins",
    game: { id: "dice", version: "1.0.0", config: { windowSeconds: 30 } },
    rewards: { kind: "weighted", bps: [6000, 3000, 1000] },
  },
};

describe("prepareGiveaway", () => {
  it("builds the createGiveaway arguments for the chain's deployment", () => {
    const prepared = prepareGiveaway(input, now);
    expect(prepared.contract).toBe("0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72");
    expect(prepared.value).toBe(input.amount);
    expect(prepared.params.startTime).toBe(BigInt(Math.floor(minutes(10).getTime() / 1000)));
    const decoded = decodeGiveawayMetadata(prepared.params.metadata);
    expect(decoded).toMatchObject({ ok: true, metadata: { v: 2, rewards: { minScore: 1 } } });
  });

  it("sends no native value with an ERC-20 prize", () => {
    const usdc = { ...input, token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const };
    expect(prepareGiveaway(usdc, now).value).toBe(0n);
  });

  it.each([
    ["a start too soon", { startTime: minutes(1) }, /at least 2 minutes/],
    ["a game window too short", { finalizeDeadline: minutes(15) }, /10 minutes/],
    ["no winners", { maxWinners: 0 }, /maxWinners/],
    ["a policy with more places than winners", { maxWinners: 2 }, /pays 3 places/],
    ["a zero amount", { amount: 0n }, /positive/],
  ])("refuses %s before any transaction", (_name, change, message) => {
    expect(() => prepareGiveaway({ ...input, ...change }, now)).toThrow(InvalidGiveawayError);
    expect(() => prepareGiveaway({ ...input, ...change }, now)).toThrow(message);
  });

  it("refuses chains FairDrops is not deployed on", () => {
    expect(() => prepareGiveaway({ ...input, chainId: 31337 }, now)).toThrow(/not deployed/);
  });
});

describe("prepareGiveaway with rounds", () => {
  const rounds = (settings: Record<string, unknown>, deadline = minutes(24 * 60)) => ({
    ...input,
    maxWinners: 6,
    finalizeDeadline: deadline,
    metadata: {
      ...input.metadata,
      v: 2 as const,
      rewards: { kind: "equal" as const, winners: 6 },
      rounds: { winnersPerRound: 2, playSeconds: 600, ...settings },
    },
  });

  it("accepts rounds that fit before the deadline", () => {
    expect(() => prepareGiveaway(rounds({ maxWinsPerPlayer: 3 }), now)).not.toThrow();
  });

  it("rejects more winners per round than places", () => {
    expect(() => prepareGiveaway(rounds({ winnersPerRound: 7 }), now)).toThrow(
      /more places than the giveaway has/,
    );
  });

  it("rejects rounds that would run past the time to settle", () => {
    // 35 minutes of one-minute dice rounds, in a 30 minute window whose last 15 are kept for
    // settling.
    expect(() => prepareGiveaway(rounds({ playSeconds: 35 * 60 }, minutes(40)), now)).toThrow(
      /doesn't leave time to settle/,
    );
  });
});

describe("createGiveaway progress", () => {
  const owner = "0x00000000000000000000000000000000000000a1";
  const wallet = {
    account: { address: owner, type: "json-rpc" },
    writeContract: () => Promise.resolve(`0x${"ab".repeat(32)}`),
  } as unknown as WalletClient;
  const client = (allowance: bigint) =>
    ({
      readContract: () => Promise.resolve(allowance),
      waitForTransactionReceipt: () =>
        Promise.resolve({ status: "success", logs: [], transactionHash: `0x${"cd".repeat(32)}` }),
    }) as unknown as PublicClient;
  const usdc = { ...input, token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const };

  it("reports approving, then locking, each waiting on the wallet and then the network", async () => {
    const seen: CreateProgress[] = [];
    // The stub receipt has no GiveawayCreated log, so the call ends there; the progress is the point.
    await expect(
      createGiveaway(wallet, prepareGiveaway(usdc, now), {
        publicClient: client(0n),
        onProgress: (progress) => seen.push(progress),
      }),
    ).rejects.toThrow(/GiveawayCreated/);
    expect(seen).toEqual([
      { step: "approve", status: "signing" },
      { step: "approve", status: "confirming" },
      { step: "approve", status: "done" },
      { step: "lock", status: "signing" },
      { step: "lock", status: "confirming" },
      { step: "lock", status: "done" },
    ]);
  });

  it("skips approval when the allowance already covers the prize", async () => {
    const seen: CreateProgress[] = [];
    await expect(
      createGiveaway(wallet, prepareGiveaway(usdc, now), {
        publicClient: client(10n ** 30n),
        onProgress: (progress) => seen.push(progress),
      }),
    ).rejects.toThrow(/GiveawayCreated/);
    expect(seen[0]).toEqual({ step: "approve", status: "skipped" });
  });
});
