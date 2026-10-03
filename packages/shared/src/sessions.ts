import { z } from "zod";
import { gameModeSchema, sessionStatusSchema } from "./games.js";
import {
  addressSchema,
  bytes32Schema,
  hexSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./primitives.js";

/** Statuses in which players can still join. The player list is fixed once a game starts. */
export const JOINABLE_SESSION_STATUSES = ["SCHEDULED", "SEED_COMMITTED", "LOBBY"] as const;

/** Statuses after the game is over, when the seed and transcript are public. */
export const ENDED_SESSION_STATUSES = ["SETTLING", "FINALIZING", "FINALIZED"] as const;

/** Why a game nobody played, or nobody won, ended. Not failures: the host gets the prize back. */
export const NOBODY_JOINED = "Nobody joined";
export const NOBODY_WON = "Nobody scored enough to win a prize";

/**
 * Whether a session ended without anyone winning: nobody joined, or nobody scored enough. The
 * giveaway then simply returns the whole prize to the host; nothing went wrong.
 */
export function endedWithoutWinners(session: {
  status: string;
  failureReason: string | null;
}): boolean {
  return (
    (session.status === "CANCELLED" && session.failureReason === NOBODY_JOINED) ||
    (session.status === "FAILED" && session.failureReason === NOBODY_WON)
  );
}

export const standingViewSchema = z.object({
  player: addressSchema,
  score: z.number().int(),
  rank: z.number().int().positive(),
});
export type StandingView = z.infer<typeof standingViewSchema>;

export const sessionViewSchema = z.object({
  id: uuidSchema,
  chainId: z.number().int().positive(),
  giveawayId: bytes32Schema,
  game: z.object({
    id: z.string(),
    version: z.string(),
    /** Null when the giveaway names a game FairDrops does not know. */
    mode: gameModeSchema.nullable(),
  }),
  status: sessionStatusSchema,
  failureReason: z.string().nullable(),
  config: z.record(z.string(), z.unknown()),
  startsAt: isoDateTimeSchema,
  /** When play stops: the planned end of a hosted game, the report deadline of an external one. */
  endsAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  endedAt: isoDateTimeSchema.nullable(),
  playerCount: z.number().int().nonnegative(),
  seedCommitment: bytes32Schema,
  /** Revealed once the game is over. */
  seed: bytes32Schema.nullable(),
  ranking: z.array(standingViewSchema).nullable(),
  transcriptHash: bytes32Schema.nullable(),
});
export type SessionView = z.infer<typeof sessionViewSchema>;

export const participantViewSchema = z.object({
  wallet: addressSchema,
  joinedAt: isoDateTimeSchema,
});
export type ParticipantView = z.infer<typeof participantViewSchema>;

/** `GET /sessions/:id/me`: whether the signed-in wallet has joined, so a page can skip "Join". */
export const membershipViewSchema = z.object({
  wallet: addressSchema,
  joined: z.boolean(),
  joinedAt: isoDateTimeSchema.nullable(),
});
export type MembershipView = z.infer<typeof membershipViewSchema>;

// External games

/**
 * An external game's server reports the final standings, best first, signed with the game's
 * `reporterAddress` as EIP-712 typed data (see SCORE_REPORT_TYPES). FairDrops assigns ranks in
 * the order given.
 */
export const scoreReportRequestSchema = z.object({
  ranking: z
    .array(z.object({ player: addressSchema, score: z.number().int() }))
    .min(1)
    .max(100_000)
    .refine(
      (ranking) => new Set(ranking.map((r) => r.player)).size === ranking.length,
      "Each player may appear once",
    ),
  /** Hash of the game's own log, if it keeps one, so the report can be audited later. */
  gameTranscriptHash: bytes32Schema.nullable().default(null),
  signature: hexSchema,
});
export type ScoreReportRequest = z.infer<typeof scoreReportRequestSchema>;

export const SCORE_REPORT_DOMAIN = { name: "FairDrops Score Report", version: "1" } as const;

/**
 * `rankingHash` is keccak256 of the canonical JSON (see canonicalJson) of `ranking` as
 * `[{ player, score }]` with lowercase addresses, which is how FairDrops parses it.
 * `gameTranscriptHash` is the zero hash when there is none.
 */
export const SCORE_REPORT_TYPES = {
  ScoreReport: [
    { name: "sessionId", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "giveawayId", type: "bytes32" },
    { name: "rankingHash", type: "bytes32" },
    { name: "gameTranscriptHash", type: "bytes32" },
  ],
} as const;

// Live play over WebSocket

/**
 * Messages a client sends on `/ws`. Connect with `?ticket=` from `POST /auth/ws-ticket` to
 * play; without one the socket can only watch.
 */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    sessionId: uuidSchema,
    /**
     * Take this player's seat in the game: a player plays on one device at a time, and the
     * newest device to claim wins. Clients claim when the game opens, and again only on
     * "Play here instead", so reconnecting after being displaced doesn't take the seat back.
     */
    claim: z.boolean().default(true),
  }),
  z.object({ type: z.literal("unsubscribe"), sessionId: uuidSchema }),
  z.object({
    type: z.literal("action"),
    sessionId: uuidSchema,
    /** Chosen by the client; echoed back so it can match results, and used to drop resends. */
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    action: z.unknown(),
  }),
  z.object({ type: z.literal("ping"), t: z.number().optional() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const actionResultSchema = z.object({
  id: z.string(),
  seq: z.number().int().nonnegative(),
  accepted: z.boolean(),
  reason: z.string().optional(),
});
export type ActionResult = z.infer<typeof actionResultSchema>;

export const wsErrorCodeSchema = z.enum([
  "BAD_MESSAGE",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "NOT_A_PLAYER",
  "NOT_RUNNING",
  "INVALID_ACTION",
  /** The player's seat is on another device; take it back with a claiming subscribe. */
  "PLAYING_ELSEWHERE",
  "RATE_LIMITED",
  "INTERNAL",
]);
export type WsErrorCode = z.infer<typeof wsErrorCodeSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    /** The signed-in wallet, or null for a spectator. */
    wallet: addressSchema.nullable(),
    serverTime: z.number(),
  }),
  /** Sent on subscribe: everything needed to render the session from scratch. */
  z.object({
    type: z.literal("snapshot"),
    sessionId: uuidSchema,
    status: sessionStatusSchema,
    publicView: z.unknown().nullable(),
    playerView: z.unknown().nullable(),
    serverTime: z.number(),
  }),
  z.object({ type: z.literal("public"), sessionId: uuidSchema, view: z.unknown() }),
  z.object({
    type: z.literal("player"),
    sessionId: uuidSchema,
    view: z.unknown(),
    result: actionResultSchema.optional(),
  }),
  z.object({
    type: z.literal("status"),
    sessionId: uuidSchema,
    status: sessionStatusSchema,
    ranking: z.array(standingViewSchema).optional(),
  }),
  /** The action was queued; its `result` follows in a `player` message. */
  z.object({ type: z.literal("received"), sessionId: uuidSchema, id: z.string() }),
  z.object({
    type: z.literal("error"),
    code: wsErrorCodeSchema,
    message: z.string(),
    sessionId: uuidSchema.optional(),
    id: z.string().optional(),
  }),
  z.object({ type: z.literal("pong"), t: z.number().optional(), serverTime: z.number() }),
  /** Another device of the same player took the seat; this one can only watch now. */
  z.object({ type: z.literal("displaced"), sessionId: uuidSchema }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// Between the worker and the API

/** Published by the session's runtime on `sessionKeys.events`; gateways forward it to sockets. */
export const sessionEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public"), view: z.unknown() }),
  z.object({
    kind: z.literal("player"),
    player: addressSchema,
    view: z.unknown(),
    result: actionResultSchema.optional(),
  }),
  z.object({
    kind: z.literal("status"),
    status: sessionStatusSchema,
    ranking: z.array(standingViewSchema).optional(),
  }),
]);
export type SessionEvent = z.infer<typeof sessionEventSchema>;

/** Redis keys shared by the API gateway and the worker runtime. */
export const sessionKeys = {
  /** Stream of player actions: fields `player`, `id` and `action` (JSON). */
  actions: (sessionId: string) => `fd:session:${sessionId}:actions`,
  /** Pub/sub channel of SessionEvent JSON. */
  events: (sessionId: string) => `fd:session:${sessionId}:events`,
  /** Latest public view, for new subscribers. */
  publicView: (sessionId: string) => `fd:session:${sessionId}:public`,
  /** Hash of the latest view per player. */
  playerViews: (sessionId: string) => `fd:session:${sessionId}:players`,
  /** Held by the worker running the game. */
  owner: (sessionId: string) => `fd:session:${sessionId}:owner`,
  /** Which connection a player plays from: one device at a time. Expires without heartbeats. */
  seat: (sessionId: string, wallet: string) => `fd:session:${sessionId}:seat:${wallet}`,
  /** Pub/sub channel where gateways announce a seat taken, so the old device is told. */
  seats: (sessionId: string) => `fd:session:${sessionId}:seats`,
} as const;

/** Players may send at most this many actions per second on one socket. */
export const MAX_ACTIONS_PER_SECOND = 20;
