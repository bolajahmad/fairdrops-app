import { z } from "zod";
import { gameIdSchema, semverSchema, type SessionStatus } from "./games.js";
import { contractLimits } from "./limits.js";
import { httpsUrlSchema, type Hex } from "./primitives.js";

/** A game and the host's settings for it. */
export const gameChoiceSchema = z.strictObject({
  id: gameIdSchema,
  version: semverSchema,
  config: z.record(z.string(), z.unknown()),
});
export type GameChoice = z.infer<typeof gameChoiceSchema>;

/**
 * The host's description of a giveaway. It is emitted in full in the `GiveawayCreated` event,
 * and the contract stores only its keccak256 hash, so the chain vouches for the exact bytes the
 * indexer reads. The game and its settings are part of the document, so they cannot be changed
 * after the prize is escrowed.
 */
export const giveawayMetadataV1Schema = z.strictObject({
  v: z.literal(1),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000),
  image: z
    .string()
    .max(500)
    .refine(
      (value) => httpsUrlSchema.safeParse(value).success || /^ipfs:\/\/[A-Za-z0-9]+/.test(value),
      "Expected an https or ipfs URL",
    )
    .optional(),
  game: gameChoiceSchema,
  rules: z.string().trim().max(500).optional(),
  links: z
    .array(z.strictObject({ label: z.string().trim().min(1).max(30), url: httpsUrlSchema }))
    .max(5)
    .optional(),
});
export type GiveawayMetadataV1 = z.infer<typeof giveawayMetadataV1Schema>;

export const BPS_DENOMINATOR = 10_000;

/**
 * Only players scoring at least this much can win. The default of 1 keeps players who joined but
 * never played out of the payouts.
 */
const minScoreSchema = z.number().int().default(1);

/**
 * How the prize is split between the ranking's best players. It is part of the metadata the host
 * commits on-chain, so verifiers cannot choose the split. Each paid place has a fixed share of
 * the prize; places nobody fills (too few qualifying players) and rounding dust stay with the
 * host, who withdraws them after finalization.
 *
 * - `equal`: each of the top `winners` places gets `prize / winners`.
 * - `weighted`: place `i` gets `bps[i] / 10000` of the prize; the shares sum to 10000.
 */
export const rewardPolicySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("equal"),
    winners: z.number().int().min(1).max(contractLimits.maxWinners),
    minScore: minScoreSchema,
  }),
  z.strictObject({
    kind: z.literal("weighted"),
    bps: z
      .array(z.number().int().min(1).max(BPS_DENOMINATOR))
      .min(1)
      .max(1_000)
      .refine(
        (bps) => bps.reduce((sum, share) => sum + share, 0) === BPS_DENOMINATOR,
        `Shares must sum to ${BPS_DENOMINATOR}`,
      ),
    minScore: minScoreSchema,
  }),
]);
export type RewardPolicy = z.infer<typeof rewardPolicySchema>;
export type RewardPolicyInput = z.input<typeof rewardPolicySchema>;

/** Most rounds a giveaway can play, whatever its play time. Keeps schedules a sensible size. */
export const MAX_ROUNDS = 1_000;
/** Longest a giveaway can play in rounds. */
export const MAX_PLAY_SECONDS = 7 * 24 * 60 * 60;

/**
 * Play in rounds for the host's play time, or until every paid place is won if that is sooner.
 * Each round plays the next game in the rotation (`game`, then each of `next`, then `game`
 * again) and awards the next `winnersPerRound` places to that round's best players who scored
 * at least `minScore`. Places a round leaves unfilled carry over. The game starts at the
 * giveaway's start even if nobody has joined yet: people can join, and leave, between rounds.
 * Whatever is still unwon when the play time is up goes back to the host.
 *
 * A player may win several places, at most `maxWinsPerPlayer` when it is set. Prizes are paid
 * once, after the last round, so a player's places are added up into one payout.
 */
export const roundsSettingsSchema = z.strictObject({
  winnersPerRound: z.number().int().min(1).max(contractLimits.maxWinners),
  /** How long rounds keep starting, from the giveaway's start. A round must end within it. */
  playSeconds: z.number().int().min(60).max(MAX_PLAY_SECONDS),
  /** Break between rounds, when people can join or leave. */
  cooldownSeconds: z.number().int().min(3).max(120).default(10),
  maxWinsPerPlayer: z.number().int().min(1).max(contractLimits.maxWinners).optional(),
  /** Hosted games played after `game`, in order, before the rotation repeats. */
  next: z.array(gameChoiceSchema).max(4).default([]),
});
export type RoundsSettings = z.infer<typeof roundsSettingsSchema>;

/** Metadata v2 adds the reward policy, and optionally rounds. Everything else is as in v1. */
export const giveawayMetadataV2Schema = giveawayMetadataV1Schema.extend({
  v: z.literal(2),
  rewards: rewardPolicySchema,
  rounds: roundsSettingsSchema.optional(),
});
export type GiveawayMetadataV2 = z.infer<typeof giveawayMetadataV2Schema>;

/** Every metadata version the indexer understands, keyed by `v`. */
export const giveawayMetadataSchema = z.discriminatedUnion("v", [
  giveawayMetadataV1Schema,
  giveawayMetadataV2Schema,
]);
export type GiveawayMetadata = z.infer<typeof giveawayMetadataSchema>;
export type GiveawayMetadataInput = z.input<typeof giveawayMetadataSchema>;

/** Number of paid places a policy has. */
export function rewardPlaces(policy: RewardPolicy): number {
  return policy.kind === "equal" ? policy.winners : policy.bps.length;
}

/**
 * The policy a giveaway pays out with. v1 metadata predates policies and splits the prize
 * equally between the top `maxWinners` players who scored.
 */
export function rewardPolicyOf(metadata: GiveawayMetadata, maxWinners: number): RewardPolicy {
  if (metadata.v === 2) return metadata.rewards;
  return { kind: "equal", winners: maxWinners, minScore: 1 };
}

/** Why a policy cannot be settled by a giveaway with this many winners, or null. */
export function rewardPolicyProblem(policy: RewardPolicy, maxWinners: number): string | null {
  const places = rewardPlaces(policy);
  if (places > maxWinners) {
    return `The reward policy pays ${places} places but the giveaway allows ${maxWinners} winners`;
  }
  return null;
}

/**
 * Serializes JSON canonically (RFC 8785): object keys sorted by UTF-16 code unit, no whitespace,
 * and ECMAScript number formatting. The same content therefore always has the same hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite numbers are not valid JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new TypeError(`Cannot serialize ${typeof value} as JSON`);
}

export interface EncodedMetadata {
  json: string;
  bytes: Uint8Array;
  /** Pass this as `metadata` to `createGiveaway`. */
  hex: Hex;
}

export class MetadataTooLargeError extends Error {
  constructor(readonly size: number) {
    super(
      `Metadata is ${size} bytes; the contract accepts at most ${contractLimits.maxMetadataBytes}`,
    );
    this.name = "MetadataTooLargeError";
  }
}

/** Validates the document, applies defaults and returns the exact bytes to put on-chain. */
export function encodeGiveawayMetadata(metadata: GiveawayMetadataInput): EncodedMetadata {
  const json = canonicalJson(giveawayMetadataSchema.parse(metadata));
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > contractLimits.maxMetadataBytes) throw new MetadataTooLargeError(bytes.length);
  return { json, bytes, hex: bytesToHex(bytes) };
}

export type DecodedMetadata =
  { ok: true; metadata: GiveawayMetadata } | { ok: false; error: string };

/**
 * Parses the bytes emitted on-chain. Anything a host wrote is accepted as input, so this never
 * throws; invalid documents come back with the reason, and that giveaway is never played.
 */
export function decodeGiveawayMetadata(input: Hex | Uint8Array): DecodedMetadata {
  let bytes: Uint8Array;
  try {
    bytes = typeof input === "string" ? hexToBytes(input) : input;
  } catch {
    return { ok: false, error: "Metadata is not valid hex" };
  }
  if (bytes.length > contractLimits.maxMetadataBytes) {
    return { ok: false, error: `Metadata exceeds ${contractLimits.maxMetadataBytes} bytes` };
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, error: "Metadata is not UTF-8 JSON" };
  }

  const result = giveawayMetadataSchema.safeParse(json);
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) };
  return { ok: true, metadata: result.data };
}

/** Giveaway status as recorded by the contract. */
export const onchainStatusSchema = z.enum(["ACTIVE", "FINALIZED", "CANCELLED", "EXPIRED"]);
export type OnchainStatus = z.infer<typeof onchainStatusSchema>;

/**
 * Entries in a giveaway's on-chain activity log, one per contract event about that giveaway.
 * Configuration and access-control events are indexed by the subgraph but are not part of it.
 */
export const giveawayEventKindSchema = z.enum([
  "CREATED",
  "FUNDS_ADDED",
  "SEED_COMMITTED",
  "FINALIZED",
  "CANCELLED",
  "EXPIRED",
  "CLAIMED",
  "HOST_WITHDRAWAL",
]);
export type GiveawayEventKind = z.infer<typeof giveawayEventKindSchema>;

/** What a giveaway means to a user right now. */
export const giveawayPhaseSchema = z.enum([
  "invalid",
  "upcoming",
  "live",
  "settling",
  "claimable",
  "closed",
  "cancelled",
  "expired",
]);
export type GiveawayPhase = z.infer<typeof giveawayPhaseSchema>;

export interface PhaseInput {
  status: OnchainStatus;
  metadataValid: boolean;
  startTime: Date;
  finalizeDeadline: Date;
  claimDeadline: Date | null;
  sessionStatus: SessionStatus | null;
}

export function deriveGiveawayPhase(input: PhaseInput, now: Date = new Date()): GiveawayPhase {
  switch (input.status) {
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    case "FINALIZED":
      return input.claimDeadline && now > input.claimDeadline ? "closed" : "claimable";
    case "ACTIVE":
      if (!input.metadataValid) return "invalid";
      if (now > input.finalizeDeadline) return "expired";
      if (input.sessionStatus === "SETTLING" || input.sessionStatus === "FINALIZING") {
        return "settling";
      }
      if (now < input.startTime) return "upcoming";
      return "live";
  }
}

function bytesToHex(bytes: Uint8Array): Hex {
  let hex = "0x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex as Hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) throw new TypeError("Invalid hex");
  const bytes = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return bytes;
}
