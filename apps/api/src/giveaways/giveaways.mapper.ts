import type {
  ChainTransaction,
  GameSession,
  Giveaway,
  GiveawayEvent,
  Settlement,
  SettlementPayout,
  SettlementSignature,
} from "@fairdrops/db";
import {
  deriveGiveawayPhase,
  findApprovedToken,
  giveawayMetadataSchema,
  rewardPolicyOf,
  rewardPolicySchema,
  toTokenView,
  type Address,
  type ClaimView,
  type GiveawayEventView,
  type GiveawayView,
  type Hex,
  type PayoutView,
  type SettlementView,
  type TokenView,
} from "@fairdrops/shared";

const decimal = (value: { toFixed(): string }) => value.toFixed();

export function tokenInfo(chainId: number, token: string): TokenView | null {
  const approved = findApprovedToken(chainId, token);
  return approved ? toTokenView(approved) : null;
}

export function toGiveawayView(
  giveaway: Giveaway,
  session: Pick<GameSession, "id" | "status"> | null,
  now = new Date(),
): GiveawayView {
  // Stored by the indexer after validation, but parsed again so a row from an older schema
  // version can never break the listing.
  const parsed = giveawayMetadataSchema.safeParse(giveaway.metadata);
  const metadata = parsed.success ? parsed.data : null;
  return {
    chainId: giveaway.chainId,
    giveawayId: giveaway.giveawayId as Hex,
    contract: giveaway.contractAddress as Address,
    host: giveaway.host as Address,
    token: giveaway.token as Address,
    tokenInfo: tokenInfo(giveaway.chainId, giveaway.token),
    prize: decimal(giveaway.prize),
    fee: decimal(giveaway.fee),
    startTime: giveaway.startTime.toISOString(),
    finalizeDeadline: giveaway.finalizeDeadline.toISOString(),
    maxWinners: giveaway.maxWinners,
    claimWindowSeconds: giveaway.claimWindowSeconds,
    metadataHex: `0x${Buffer.from(giveaway.metadataRaw).toString("hex")}`,
    metadata,
    metadataError: giveaway.metadataError,
    rewards: metadata ? rewardPolicyOf(metadata, giveaway.maxWinners) : null,
    status: giveaway.status,
    phase: deriveGiveawayPhase(
      {
        status: giveaway.status,
        metadataValid: metadata !== null,
        startTime: giveaway.startTime,
        finalizeDeadline: giveaway.finalizeDeadline,
        claimDeadline: giveaway.claimDeadline,
        sessionStatus: session?.status ?? null,
      },
      now,
    ),
    seedCommitment: giveaway.seedCommitment as Hex | null,
    payoutRoot: giveaway.payoutRoot as Hex | null,
    totalPayout: decimal(giveaway.totalPayout),
    winnerCount: giveaway.winnerCount,
    transcriptHash: giveaway.transcriptHash as Hex | null,
    claimDeadline: giveaway.claimDeadline?.toISOString() ?? null,
    claimed: decimal(giveaway.claimed),
    withdrawn: decimal(giveaway.withdrawn),
    createdAt: giveaway.createdAt.toISOString(),
    createdTxHash: giveaway.createdTxHash as Hex,
    session: session ? { id: session.id, status: session.status } : null,
  };
}

export function toEventView(event: GiveawayEvent): GiveawayEventView {
  return {
    kind: event.kind,
    blockNumber: event.blockNumber.toString(),
    logIndex: event.logIndex,
    transactionHash: event.transactionHash as Hex,
    timestamp: event.timestamp.toISOString(),
    account: event.account as Address | null,
    recipient: event.recipient as Address | null,
    amount: event.amount ? decimal(event.amount) : null,
    fee: event.fee ? decimal(event.fee) : null,
  };
}

export function toPayoutView(payout: SettlementPayout): PayoutView {
  return {
    account: payout.account as Address,
    amount: decimal(payout.amount),
    rank: payout.rank,
    claimedAt: payout.claimedAt?.toISOString() ?? null,
    claimTx: payout.claimTx as Hex | null,
  };
}

export type SettlementWithRelations = Settlement & {
  payouts: SettlementPayout[];
  signatures: SettlementSignature[];
  finalizeTx: ChainTransaction | null;
  session: { giveaway: Pick<Giveaway, "contractAddress"> };
};

export function toSettlementView(settlement: SettlementWithRelations): SettlementView {
  const tx = settlement.finalizeTx;
  return {
    sessionId: settlement.sessionId,
    chainId: settlement.chainId,
    contract: settlement.session.giveaway.contractAddress as Address,
    giveawayId: settlement.giveawayId as Hex,
    status: settlement.status,
    policy: rewardPolicySchema.parse(settlement.policy),
    prize: decimal(settlement.prize),
    payoutRoot: settlement.payoutRoot as Hex,
    totalPayout: decimal(settlement.totalPayout),
    winnerCount: settlement.winnerCount,
    seed: settlement.seed as Hex,
    transcriptHash: settlement.transcriptHash as Hex,
    digest: settlement.digest as Hex,
    signatures: [...settlement.signatures]
      .sort((a, b) => (BigInt(a.verifier) < BigInt(b.verifier) ? -1 : 1))
      .map((s) => ({ verifier: s.verifier as Address, signature: s.signature as Hex })),
    finalizeTx: tx ? ((tx.minedHash ?? tx.hashes.at(-1)) as Hex) : null,
    confirmedAt: settlement.confirmedAt?.toISOString() ?? null,
    failureReason: settlement.failureReason,
    payouts: [...settlement.payouts].sort((a, b) => a.rank - b.rank).map(toPayoutView),
  };
}

export function toClaimView(
  payout: SettlementPayout,
  settlement: Pick<Settlement, "status" | "chainId" | "giveawayId" | "sessionId">,
  giveaway: Pick<Giveaway, "contractAddress" | "status" | "claimDeadline" | "token">,
  recipient: string | null,
  now = new Date(),
): ClaimView {
  const open =
    settlement.status === "CONFIRMED" &&
    giveaway.status === "FINALIZED" &&
    giveaway.claimDeadline !== null &&
    giveaway.claimDeadline > now;
  return {
    chainId: settlement.chainId,
    contract: giveaway.contractAddress as Address,
    giveawayId: settlement.giveawayId as Hex,
    sessionId: settlement.sessionId,
    account: payout.account as Address,
    amount: decimal(payout.amount),
    proof: payout.proof as Hex[],
    recipient: (recipient ?? payout.account) as Address,
    claimable: open && payout.claimedAt === null,
    claimedAt: payout.claimedAt?.toISOString() ?? null,
    claimTx: payout.claimTx as Hex | null,
    claimDeadline: giveaway.claimDeadline?.toISOString() ?? null,
    tokenInfo: tokenInfo(settlement.chainId, giveaway.token),
    token: giveaway.token as Address,
  };
}
