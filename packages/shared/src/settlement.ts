import { z } from "zod";
import { sessionStatusSchema } from "./games.js";
import {
  giveawayEventKindSchema,
  giveawayMetadataSchema,
  giveawayPhaseSchema,
  onchainStatusSchema,
  rewardPolicySchema,
} from "./giveaways.js";
import {
  addressSchema,
  bytes32Schema,
  chainIdSchema,
  hexSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
  uint256Schema,
  uuidSchema,
} from "./primitives.js";
import { tokenViewSchema } from "./tokens.js";

// Giveaways, as indexed from the chain

export const giveawayViewSchema = z.object({
  chainId: z.number().int().positive(),
  giveawayId: bytes32Schema,
  contract: addressSchema,
  host: addressSchema,
  /** Zero address for the native currency. */
  token: addressSchema,
  /** Symbol and decimals when the token is on the approved list, otherwise null. */
  tokenInfo: tokenViewSchema.nullable(),
  prize: uint256Schema,
  fee: uint256Schema,
  startTime: isoDateTimeSchema,
  finalizeDeadline: isoDateTimeSchema,
  maxWinners: z.number().int().positive(),
  claimWindowSeconds: z.number().int().positive(),
  /** The exact bytes the host emitted. Their keccak256 is the `metadataHash` stored on-chain. */
  metadataHex: hexSchema,
  /** The host's document, or null when it failed validation (see metadataError). */
  metadata: giveawayMetadataSchema.nullable(),
  metadataError: z.string().nullable(),
  /** The split the result pays out with; null when the metadata is invalid. */
  rewards: rewardPolicySchema.nullable(),
  status: onchainStatusSchema,
  phase: giveawayPhaseSchema,
  seedCommitment: bytes32Schema.nullable(),
  payoutRoot: bytes32Schema.nullable(),
  totalPayout: uint256Schema,
  winnerCount: z.number().int().nonnegative(),
  transcriptHash: bytes32Schema.nullable(),
  claimDeadline: isoDateTimeSchema.nullable(),
  claimed: uint256Schema,
  withdrawn: uint256Schema,
  createdAt: isoDateTimeSchema,
  createdTxHash: bytes32Schema,
  session: z.object({ id: uuidSchema, status: sessionStatusSchema }).nullable(),
});
export type GiveawayView = z.infer<typeof giveawayViewSchema>;

export const giveawayListQuerySchema = paginationQuerySchema.extend({
  chainId: chainIdSchema.optional(),
  status: onchainStatusSchema.optional(),
  host: addressSchema.optional(),
});
export type GiveawayListQuery = z.infer<typeof giveawayListQuerySchema>;
export type GiveawayListQueryInput = z.input<typeof giveawayListQuerySchema>;

export const giveawayEventViewSchema = z.object({
  kind: giveawayEventKindSchema,
  blockNumber: z.string(),
  logIndex: z.number().int().nonnegative(),
  transactionHash: bytes32Schema,
  timestamp: isoDateTimeSchema,
  account: addressSchema.nullable(),
  recipient: addressSchema.nullable(),
  amount: uint256Schema.nullable(),
  fee: uint256Schema.nullable(),
});
export type GiveawayEventView = z.infer<typeof giveawayEventViewSchema>;

// Settlement

/**
 * PROPOSED: payouts computed, waiting for verifier signatures. SIGNED: enough signatures to
 * finalize. SUBMITTED: the finalize transaction was sent. CONFIRMED: the chain recorded it.
 * ABANDONED: it can no longer be finalized (the giveaway ended another way).
 */
export const settlementStatusSchema = z.enum([
  "PROPOSED",
  "SIGNED",
  "SUBMITTED",
  "CONFIRMED",
  "ABANDONED",
]);
export type SettlementStatus = z.infer<typeof settlementStatusSchema>;

export const payoutViewSchema = z.object({
  account: addressSchema,
  amount: uint256Schema,
  /** Place in the ranking, 1 for the winner. */
  rank: z.number().int().positive(),
  claimedAt: isoDateTimeSchema.nullable(),
  claimTx: bytes32Schema.nullable(),
});
export type PayoutView = z.infer<typeof payoutViewSchema>;

export const settlementViewSchema = z.object({
  sessionId: uuidSchema,
  chainId: z.number().int().positive(),
  contract: addressSchema,
  giveawayId: bytes32Schema,
  status: settlementStatusSchema,
  policy: rewardPolicySchema,
  /** The escrowed prize the shares are taken from. */
  prize: uint256Schema,
  payoutRoot: bytes32Schema,
  totalPayout: uint256Schema,
  winnerCount: z.number().int().nonnegative(),
  seed: bytes32Schema,
  transcriptHash: bytes32Schema,
  /** The EIP-712 digest verifiers sign (`settlementDigest` on the contract). */
  digest: bytes32Schema,
  signatures: z.array(z.object({ verifier: addressSchema, signature: hexSchema })),
  finalizeTx: bytes32Schema.nullable(),
  confirmedAt: isoDateTimeSchema.nullable(),
  failureReason: z.string().nullable(),
  payouts: z.array(payoutViewSchema),
});
export type SettlementView = z.infer<typeof settlementViewSchema>;

/**
 * The payout tree in OpenZeppelin's `StandardMerkleTree.dump()` format, so anyone can load it
 * with `StandardMerkleTree.load` and check the root and every proof.
 */
export const payoutTreeDumpSchema = z.object({
  format: z.literal("standard-v1"),
  leafEncoding: z.tuple([z.literal("bytes32"), z.literal("address"), z.literal("uint256")]),
  tree: z.array(bytes32Schema),
  values: z.array(
    z.object({
      value: z.tuple([bytes32Schema, addressSchema, uint256Schema]),
      treeIndex: z.number().int().nonnegative(),
    }),
  ),
});
export type PayoutTreeDump = z.infer<typeof payoutTreeDumpSchema>;

// Claims

export const claimViewSchema = z.object({
  chainId: z.number().int().positive(),
  contract: addressSchema,
  giveawayId: bytes32Schema,
  sessionId: uuidSchema,
  account: addressSchema,
  amount: uint256Schema,
  proof: z.array(bytes32Schema),
  /** Where the prize goes: the account's payout wallet if it set one, otherwise the account. */
  recipient: addressSchema,
  /** Claims open once the result is on-chain. */
  claimable: z.boolean(),
  claimedAt: isoDateTimeSchema.nullable(),
  claimTx: bytes32Schema.nullable(),
  claimDeadline: isoDateTimeSchema.nullable(),
  tokenInfo: tokenViewSchema.nullable(),
  token: addressSchema,
});
export type ClaimView = z.infer<typeof claimViewSchema>;
