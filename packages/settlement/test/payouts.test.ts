import { rewardPolicySchema, type Address, type RewardPolicy } from "@fairdrops/shared";
import { describe, expect, it } from "vitest";
import {
  SettlementError,
  computePayouts,
  placeShares,
  totalOf,
  type RankedPlayer,
} from "../src/payouts.js";

const player = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
const ranked = (...scores: number[]): RankedPlayer[] =>
  scores.map((score, i) => ({ player: player(i + 1), score, rank: i + 1 }));
const equal = (winners: number, minScore = 1): RewardPolicy =>
  rewardPolicySchema.parse({ kind: "equal", winners, minScore });
const weighted = (bps: number[], minScore = 1): RewardPolicy =>
  rewardPolicySchema.parse({ kind: "weighted", bps, minScore });

describe("placeShares", () => {
  it("splits equally and rounds down", () => {
    expect(placeShares(equal(3), 1000n)).toEqual([333n, 333n, 333n]);
  });

  it("takes each weighted share in basis points", () => {
    expect(placeShares(weighted([5000, 3000, 2000]), 999n)).toEqual([499n, 299n, 199n]);
  });
});

describe("computePayouts", () => {
  it("pays the top places in rank order, whatever order the ranking arrives in", () => {
    const ranking = ranked(9, 7, 5).reverse();
    expect(computePayouts(ranking, weighted([6000, 4000]), 1000n)).toEqual([
      { account: player(1), amount: 600n, rank: 1 },
      { account: player(2), amount: 400n, rank: 2 },
    ]);
  });

  it("skips players below the minimum score and moves the next player up", () => {
    // Player 2 never scored; player 3 takes the second paid place.
    const ranking: RankedPlayer[] = [
      { player: player(1), score: 5, rank: 1 },
      { player: player(2), score: 0, rank: 2 },
      { player: player(3), score: 3, rank: 3 },
    ];
    expect(computePayouts(ranking, equal(2), 100n).map((p) => p.account)).toEqual([
      player(1),
      player(3),
    ]);
  });

  it("leaves places nobody fills unpaid instead of enlarging other shares", () => {
    const payouts = computePayouts(ranked(4), equal(3), 900n);
    expect(payouts).toEqual([{ account: player(1), amount: 300n, rank: 1 }]);
  });

  it("returns no payouts when nobody qualifies", () => {
    expect(computePayouts(ranked(0, 0), equal(2), 100n)).toEqual([]);
    expect(computePayouts([], equal(2), 100n)).toEqual([]);
  });

  it("drops places whose share rounds to zero", () => {
    expect(computePayouts(ranked(3, 2, 1), equal(3), 2n)).toEqual([]);
    expect(computePayouts(ranked(3, 2), weighted([9999, 1]), 5_000n)).toHaveLength(1);
  });

  it("allows scores below zero when the policy does", () => {
    expect(computePayouts(ranked(-2, -5), equal(2, -10), 10n)).toHaveLength(2);
  });

  it("rejects rankings with a repeated player or rank", () => {
    const twice = [...ranked(3), { player: player(1), score: 2, rank: 2 }];
    expect(() => computePayouts(twice, equal(1), 1n)).toThrow(SettlementError);
    const tie = [...ranked(3), { player: player(9), score: 3, rank: 1 }];
    expect(() => computePayouts(tie, equal(1), 1n)).toThrow(/Rank 1/);
  });

  it("never pays more than the prize, and is deterministic, over many random inputs", () => {
    let state = 0x9e3779b9;
    const next = (n: number) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state % n;
    };
    for (let round = 0; round < 500; round++) {
      const players = next(12);
      const ranking = ranked(...Array.from({ length: players }, () => next(20) - 3));
      const places = 1 + next(8);
      const policy =
        next(2) === 0
          ? equal(places, next(3))
          : weighted(
              (() => {
                const bps = Array.from({ length: places }, () => 1);
                let left = 10_000 - places;
                for (let i = 0; i < places && left > 0; i++) {
                  const take = i === places - 1 ? left : next(left + 1);
                  bps[i]! += take;
                  left -= take;
                }
                return bps;
              })(),
              next(3),
            );
      const prize = BigInt(next(1_000_000)) * 10n ** BigInt(next(19));

      const payouts = computePayouts(ranking, policy, prize);
      expect(totalOf(payouts)).toBeLessThanOrEqual(prize);
      expect(payouts.length).toBeLessThanOrEqual(places);
      expect(payouts.every((p) => p.amount > 0n)).toBe(true);
      expect(new Set(payouts.map((p) => p.account)).size).toBe(payouts.length);
      expect(computePayouts([...ranking].reverse(), policy, prize)).toEqual(payouts);
    }
  });
});
