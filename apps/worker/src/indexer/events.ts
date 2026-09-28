import type { Address, Hex } from "@fairdrops/shared";
import { z } from "zod";

/**
 * FairDropsEvent rows as the subgraph returns them: Bytes as lowercase hex, BigInt as decimal
 * strings, and only the parameters of `kind` set. See packages/subgraph/schema.graphql.
 */
const hex = z
  .string()
  .regex(/^0x([0-9a-f]{2})*$/)
  .transform((value) => value as Hex);
const bytes32 = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/)
  .transform((value) => value as Hex);
const address = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/)
  .transform((value) => value as Address);
const uint = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform((value) => BigInt(value));

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

export const EVENT_ID_ZERO = "0x000000000000000000000000";

export const rawEventSchema = z.object({
  id: z.string().regex(/^0x[0-9a-f]{24}$/),
  kind: z.string(),
  blockNumber: uint,
  blockHash: bytes32,
  timestamp: uint,
  transactionHash: bytes32,
  logIndex: uint,
  giveaway: nullable(z.object({ id: bytes32 })),
  host: nullable(address),
  token: nullable(address),
  prize: nullable(uint),
  fee: nullable(uint),
  startTime: nullable(uint),
  finalizeDeadline: nullable(uint),
  maxWinners: nullable(uint),
  claimWindow: nullable(uint),
  metadataHash: nullable(bytes32),
  metadata: nullable(hex),
  from: nullable(address),
  prizeAdded: nullable(uint),
  feeAdded: nullable(uint),
  commitment: nullable(bytes32),
  payoutRoot: nullable(bytes32),
  totalPayout: nullable(uint),
  winnerCount: nullable(uint),
  seed: nullable(bytes32),
  transcriptHash: nullable(bytes32),
  claimDeadline: nullable(uint),
  by: nullable(address),
  account: nullable(address),
  recipient: nullable(address),
  amount: nullable(uint),
  wallet: nullable(address),
});
export type RawEvent = z.infer<typeof rawEventSchema>;

/** The fields selected for each event. Kept next to the schema so the two cannot drift. */
export const RAW_EVENT_FIELDS = Object.keys(rawEventSchema.shape)
  .map((field) => (field === "giveaway" ? "giveaway { id }" : field))
  .join("\n");

interface Position {
  /** Event id: block number and log index, big-endian, as hex. */
  id: string;
  blockNumber: bigint;
  logIndex: number;
  blockHash: Hex;
  transactionHash: Hex;
  timestamp: Date;
}

export type FairDropsEvent = Position &
  (
    | {
        kind: "GiveawayCreated";
        giveawayId: Hex;
        host: Address;
        token: Address;
        prize: bigint;
        fee: bigint;
        startTime: Date;
        finalizeDeadline: Date;
        maxWinners: number;
        claimWindowSeconds: number;
        metadataHash: Hex;
        metadata: Hex;
      }
    | { kind: "FundsAdded"; giveawayId: Hex; from: Address; prizeAdded: bigint; feeAdded: bigint }
    | { kind: "SeedCommitted"; giveawayId: Hex; commitment: Hex }
    | {
        kind: "GiveawayFinalized";
        giveawayId: Hex;
        payoutRoot: Hex;
        totalPayout: bigint;
        winnerCount: number;
        seed: Hex;
        transcriptHash: Hex;
        claimDeadline: Date;
      }
    | { kind: "GiveawayCancelled"; giveawayId: Hex; by: Address }
    | { kind: "GiveawayExpired"; giveawayId: Hex }
    | { kind: "Claimed"; giveawayId: Hex; account: Address; recipient: Address; amount: bigint }
    | {
        kind: "HostWithdrawal";
        giveawayId: Hex;
        host: Address;
        recipient: Address;
        amount: bigint;
      }
    | { kind: "PayoutWalletSet"; account: Address; wallet: Address }
    /** Configuration and access-control events. Recorded by the subgraph, not projected. */
    | { kind: "Other"; name: string }
  );

export class MalformedEventError extends Error {
  constructor(event: RawEvent, field: string) {
    super(`${event.kind} event ${event.id} is missing ${field}`);
    this.name = "MalformedEventError";
  }
}

/** Converts a subgraph row into a typed event, checking the parameters its kind requires. */
export function toEvent(raw: RawEvent): FairDropsEvent {
  const need = <K extends keyof RawEvent>(field: K): NonNullable<RawEvent[K]> => {
    const value = raw[field];
    if (value === null || value === undefined) throw new MalformedEventError(raw, field);
    return value;
  };
  const giveawayId = () => need("giveaway").id;
  const time = (seconds: bigint) => new Date(Number(seconds) * 1000);
  const small = (value: bigint) => {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${value} is too large`);
    return Number(value);
  };

  const position: Position = {
    id: raw.id,
    blockNumber: raw.blockNumber,
    logIndex: small(raw.logIndex),
    blockHash: raw.blockHash,
    transactionHash: raw.transactionHash,
    timestamp: time(raw.timestamp),
  };

  switch (raw.kind) {
    case "GiveawayCreated":
      return {
        ...position,
        kind: raw.kind,
        giveawayId: giveawayId(),
        host: need("host"),
        token: need("token"),
        prize: need("prize"),
        fee: need("fee"),
        startTime: time(need("startTime")),
        finalizeDeadline: time(need("finalizeDeadline")),
        maxWinners: small(need("maxWinners")),
        claimWindowSeconds: small(need("claimWindow")),
        metadataHash: need("metadataHash"),
        metadata: need("metadata"),
      };
    case "FundsAdded":
      return {
        ...position,
        kind: raw.kind,
        giveawayId: giveawayId(),
        from: need("from"),
        prizeAdded: need("prizeAdded"),
        feeAdded: need("feeAdded"),
      };
    case "SeedCommitted":
      return {
        ...position,
        kind: raw.kind,
        giveawayId: giveawayId(),
        commitment: need("commitment"),
      };
    case "GiveawayFinalized":
      return {
        ...position,
        kind: raw.kind,
        giveawayId: giveawayId(),
        payoutRoot: need("payoutRoot"),
        totalPayout: need("totalPayout"),
        winnerCount: small(need("winnerCount")),
        seed: need("seed"),
        transcriptHash: need("transcriptHash"),
        claimDeadline: time(need("claimDeadline")),
      };
    case "GiveawayCancelled":
      return { ...position, kind: raw.kind, giveawayId: giveawayId(), by: need("by") };
    case "GiveawayExpired":
      return { ...position, kind: raw.kind, giveawayId: giveawayId() };
    case "Claimed":
      return {
        ...position,
        kind: raw.kind,
        giveawayId: giveawayId(),
        account: need("account"),
        recipient: need("recipient"),
        amount: need("amount"),
      };
    case "HostWithdrawal":
      return {
        ...position,
        kind: raw.kind,
        giveawayId: giveawayId(),
        host: need("host"),
        recipient: need("recipient"),
        amount: need("amount"),
      };
    case "PayoutWalletSet":
      return { ...position, kind: raw.kind, account: need("account"), wallet: need("wallet") };
    default:
      return { ...position, kind: "Other", name: raw.kind };
  }
}
