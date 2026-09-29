import { NATIVE_TOKEN_ADDRESS, decodeGiveawayMetadata } from "@fairdrops/shared";
import { describe, expect, it } from "vitest";
import { InvalidGiveawayError, prepareGiveaway, type CreateGiveawayInput } from "../src/host.js";

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
    game: { id: "dice", version: "1.0.0", config: { windowSeconds: 60 } },
    rewards: { kind: "weighted", bps: [6000, 3000, 1000] },
  },
};

describe("prepareGiveaway", () => {
  it("builds the createGiveaway arguments for the chain's deployment", () => {
    const prepared = prepareGiveaway(input, now);
    expect(prepared.contract).toBe("0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca");
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
