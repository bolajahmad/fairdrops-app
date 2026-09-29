import {
  addressSchema,
  bytes32Schema,
  canonicalJson,
  hexSchema,
  uuidSchema,
  type Hex,
} from "@fairdrops/shared";
import { z } from "zod";
import { hashJson } from "./hash.js";
import { findHostedGame } from "./registry.js";
import { Rng } from "./rng.js";
import type { Standing } from "./types.js";

const millis = z.number().int().nonnegative();

export const standingSchema = z.strictObject({
  player: addressSchema,
  score: z.number().int(),
  rank: z.number().int().positive(),
});

const sessionRefSchema = z.strictObject({
  id: uuidSchema,
  chainId: z.number().int().positive(),
  contract: addressSchema,
  giveawayId: bytes32Schema,
});

const gameRefSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
});

const common = {
  v: z.literal(1),
  session: sessionRefSchema,
  game: gameRefSchema,
  /** The config after defaults were applied, exactly as the game received it. */
  config: z.record(z.string(), z.unknown()),
  /** The committed seed: keccak256(abi.encode(giveawayId, seed)) is on-chain. */
  seed: bytes32Schema,
  startAt: millis,
  endAt: millis,
  /** Everyone who joined before the start, lowercase and sorted. */
  players: z.array(addressSchema),
  /** Final standings, best first. */
  ranking: z.array(standingSchema),
};

/** Everything needed to replay a hosted game and check its result. */
export const hostedTranscriptSchema = z.strictObject({
  ...common,
  mode: z.literal("HOSTED"),
  resources: z.array(
    z.strictObject({ kind: z.string().min(1), hash: bytes32Schema, content: z.unknown() }),
  ),
  /** Every action FairDrops sequenced, accepted or not, in order. */
  actions: z.array(
    z.strictObject({
      seq: z.number().int().nonnegative(),
      player: addressSchema,
      at: millis,
      action: z.unknown(),
    }),
  ),
});
export type HostedTranscript = z.infer<typeof hostedTranscriptSchema>;

/**
 * An external game's result, as its developer's server reported and signed it. FairDrops can
 * check who signed it but not replay it; the game's own log is referenced by hash.
 */
export const externalTranscriptSchema = z.strictObject({
  ...common,
  mode: z.literal("EXTERNAL"),
  report: z.strictObject({
    reporter: addressSchema,
    signature: hexSchema,
    gameTranscriptHash: bytes32Schema.nullable(),
    receivedAt: millis,
  }),
});
export type ExternalTranscript = z.infer<typeof externalTranscriptSchema>;

export const transcriptSchema = z.discriminatedUnion("mode", [
  hostedTranscriptSchema,
  externalTranscriptSchema,
]);
export type Transcript = z.infer<typeof transcriptSchema>;

/** The hash settled on-chain as `transcriptHash`. */
export function transcriptHash(transcript: Transcript): Hex {
  return hashJson(transcript);
}

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

/**
 * Replays a hosted game from its transcript and returns the standings it produces. Throws if the
 * transcript is not internally consistent: unknown game, tampered resources or a gap in the log.
 */
export function replay(transcript: HostedTranscript): Standing[] {
  const game = findHostedGame(transcript.game.id, transcript.game.version);
  if (!game) {
    throw new ReplayError(`Unknown game ${transcript.game.id}@${transcript.game.version}`);
  }

  const resources = new Map<Hex, unknown>();
  for (const resource of transcript.resources) {
    if (hashJson(resource.content) !== resource.hash) {
      throw new ReplayError(`Resource ${resource.hash} does not match its content`);
    }
    resources.set(resource.hash, resource.content);
  }

  const config = game.config.parse(transcript.config);
  const state = game.init({
    config,
    players: transcript.players,
    startAt: transcript.startAt,
    rng: Rng.fromSeed(transcript.seed),
    resources,
  });

  transcript.actions.forEach((entry, index) => {
    if (entry.seq !== index) throw new ReplayError(`Action ${index} has seq ${entry.seq}`);
    const action = game.action.safeParse(entry.action);
    if (!action.success) throw new ReplayError(`Action ${index} is not valid for this game`);
    game.apply(state, action.data, { player: entry.player, seq: entry.seq, at: entry.at });
  });

  return game.rank(state);
}

export type Verification = { ok: true } | { ok: false; reason: string };

/** Checks that replaying a hosted transcript gives exactly the standings it records. */
export function verifyTranscript(transcript: HostedTranscript): Verification {
  let replayed: Standing[];
  try {
    replayed = replay(transcript);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (canonicalJson(replayed) !== canonicalJson(transcript.ranking)) {
    return { ok: false, reason: "Replaying the actions gives different standings" };
  }
  return { ok: true };
}
