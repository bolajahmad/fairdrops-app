import { BPS_DENOMINATOR, rewardPlaces, type Address, type RewardPolicy } from "@fairdrops/shared";

/** A player's place in a finished game, as ranked by the game. */
export interface RankedPlayer {
  player: Address;
  score: number;
  /** 1 for the winner. Unique within a ranking. */
  rank: number;
}

export interface Payout {
  account: Address;
  amount: bigint;
  rank: number;
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

/**
 * The prize share of each paid place, best first. Integer division rounds down, so the shares
 * never add up to more than the prize; the dust stays with the host.
 */
export function placeShares(policy: RewardPolicy, prize: bigint): bigint[] {
  if (prize < 0n) throw new SettlementError("The prize cannot be negative");
  if (policy.kind === "equal") {
    const share = prize / BigInt(policy.winners);
    return Array.from({ length: policy.winners }, () => share);
  }
  return policy.bps.map((bps) => (prize * BigInt(bps)) / BigInt(BPS_DENOMINATOR));
}

/**
 * Turns a game's ranking into payouts under a reward policy. Players below the policy's minimum
 * score never win; the remaining players fill the paid places in rank order. Places nobody fills
 * and places whose share rounds to zero are not paid.
 *
 * Deterministic: the same ranking, policy and prize always give the same payouts, which is what
 * lets every verifier (and anyone else) reach the same Merkle root independently.
 */
export function computePayouts(
  ranking: readonly RankedPlayer[],
  policy: RewardPolicy,
  prize: bigint,
): Payout[] {
  const players = new Set<string>();
  const ranks = new Set<number>();
  for (const entry of ranking) {
    const player = entry.player.toLowerCase();
    if (players.has(player)) throw new SettlementError(`Player ${player} is ranked twice`);
    if (ranks.has(entry.rank)) throw new SettlementError(`Rank ${entry.rank} is used twice`);
    if (!Number.isInteger(entry.rank) || entry.rank < 1) {
      throw new SettlementError(`Rank ${entry.rank} is not a positive integer`);
    }
    players.add(player);
    ranks.add(entry.rank);
  }

  const shares = placeShares(policy, prize);
  const qualifying = [...ranking]
    .sort((a, b) => a.rank - b.rank)
    .filter((entry) => entry.score >= policy.minScore)
    .slice(0, rewardPlaces(policy));

  const payouts: Payout[] = [];
  qualifying.forEach((entry, place) => {
    const amount = shares[place] ?? 0n;
    if (amount > 0n) {
      payouts.push({ account: entry.player.toLowerCase() as Address, amount, rank: entry.rank });
    }
  });
  return payouts;
}

export function totalOf(payouts: readonly Payout[]): bigint {
  return payouts.reduce((sum, payout) => sum + payout.amount, 0n);
}
