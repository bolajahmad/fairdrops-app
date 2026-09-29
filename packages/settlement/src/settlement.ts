import type { Hex, RewardPolicy } from "@fairdrops/shared";
import { computePayouts, totalOf, type Payout, type RankedPlayer } from "./payouts.js";
import { PayoutTree } from "./tree.js";
import type { SettlementMessage } from "./typed-data.js";

export interface SettlementInput {
  giveawayId: Hex;
  ranking: readonly RankedPlayer[];
  policy: RewardPolicy;
  /** The escrowed prize, fixed once the giveaway starts. */
  prize: bigint;
}

export interface ComputedSettlement {
  payouts: Payout[];
  tree: PayoutTree;
  payoutRoot: Hex;
  totalPayout: bigint;
  winnerCount: number;
}

/**
 * Computes what a giveaway pays out: the payouts under its policy and their Merkle tree. Returns
 * null when nobody qualifies, in which case there is nothing to finalize and the giveaway is
 * cancelled so the host is refunded.
 */
export function computeSettlement(input: SettlementInput): ComputedSettlement | null {
  const payouts = computePayouts(input.ranking, input.policy, input.prize);
  if (payouts.length === 0) return null;
  const tree = PayoutTree.build(input.giveawayId, payouts);
  return {
    payouts,
    tree,
    payoutRoot: tree.root,
    totalPayout: totalOf(payouts),
    winnerCount: payouts.length,
  };
}

/** The message verifiers sign for a computed settlement. */
export function settlementMessage(
  giveawayId: Hex,
  settlement: Pick<ComputedSettlement, "payoutRoot" | "totalPayout" | "winnerCount">,
  seed: Hex,
  transcriptHash: Hex,
): SettlementMessage {
  return {
    giveawayId,
    payoutRoot: settlement.payoutRoot,
    totalPayout: settlement.totalPayout,
    winnerCount: settlement.winnerCount,
    seed,
    transcriptHash,
  };
}
