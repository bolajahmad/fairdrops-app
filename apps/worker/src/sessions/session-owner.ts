import type { Logger } from "@nestjs/common";
import type { Prisma } from "@fairdrops/db";
import {
  Rng,
  findHostedGame,
  hostedTranscriptSchema,
  type AnyHostedGame,
} from "@fairdrops/game-kit";
import { sessionKeys, type Address, type Hex } from "@fairdrops/shared";
import type { Redis } from "ioredis";
import type { Database } from "../infra/prisma.module.js";
import type { Lease } from "./lease.js";
import { loadResources, resourceMap } from "./resources.js";
import type { SeedVault } from "./seed-vault.js";
import type { PlayerUpdate, SessionBus } from "./session-bus.js";
import type { SessionLifecycle } from "./session-lifecycle.js";

/** Longest a blocking read waits, so the lease is renewed well before it expires. */
const MAX_BLOCK_MS = 500;
/** Minimum spacing of public view updates caused by actions; checkpoints publish at once. */
const PUBLIC_VIEW_INTERVAL_MS = 200;
const READ_COUNT = 500;
const VIEW_PUBLISH_CHUNK = 500;

export interface OwnerDeps {
  db: Database;
  redis: Redis;
  bus: SessionBus;
  lifecycle: SessionLifecycle;
  vault: SeedVault;
  logger: Logger;
}

export type OwnerOutcome =
  /** The game ended and its result is recorded. */
  | "settled"
  /** Another worker holds the session now, or it left RUNNING (for example, it was cancelled). */
  | "lost"
  /** Stopped on request, such as a shutdown. Another worker carries on from the log. */
  | "stopped";

/** Thrown when the session's cursor moved under us: another runtime is writing to it. */
class Fenced extends Error {}

type StreamEntries = [string, [string, string[]][]][] | null;

interface Game {
  definition: AnyHostedGame;
  config: unknown;
  state: unknown;
  /** Everyone who joined before the start, as the transcript lists them. */
  players: Address[];
  /** Everyone who may act: the players, plus anyone who joined a game played in rounds. */
  participants: Set<Address>;
  startAt: number;
  endAt: number;
  seed: Hex;
  resources: { kind: string; hash: Hex; content: unknown }[];
}

/**
 * Runs one hosted game for as long as this worker holds its lease.
 *
 * Players' actions arrive on a Redis stream, appended by the API gateways. The owner is the only
 * reader: it gives each action the next sequence number, logs a batch of them in Postgres and
 * advances the session's stream cursor in the same transaction, then applies them to the game
 * and publishes the new views. The cursor update is conditional on the cursor the owner last
 * wrote, so if a lease is ever held twice, only one writer succeeds.
 *
 * All game state is rebuilt from the Postgres log when an owner starts, so a crashed worker's
 * game carries on elsewhere with the same result. Actions still in the stream are not lost:
 * the new owner reads on from the logged cursor. Time comes from Redis, whose clock also
 * timestamps the stream, so every decision about lateness uses one clock.
 */
export class SessionOwner {
  private stopped = false;
  private readonly reader: Redis;
  private cursor = "0-0";
  private seq = 0;
  private readonly seen = new Set<string>();
  private publicDirty = true;
  private lastPublicAt = 0;

  constructor(
    readonly sessionId: string,
    private readonly lease: Lease,
    private readonly deps: OwnerDeps,
  ) {
    this.reader = deps.redis.duplicate();
  }

  /** Asks the loop to exit after its current step. */
  stop(): void {
    this.stopped = true;
  }

  async run(): Promise<OwnerOutcome> {
    try {
      const game = await this.load();
      if (!game) return "lost";

      await this.publishEverything(game, await this.now());
      const checkpoints = game.definition
        .checkpoints(game.config, game.startAt)
        .sort((a, b) => a - b);

      for (;;) {
        if (this.stopped) return "stopped";
        if (!(await this.lease.renew())) return "lost";
        const now = await this.now();
        if (now >= game.endAt) break;
        // Rounds end early once every prize is won.
        const decided = game.definition.decidedAt?.(game.state, now) ?? null;
        if (decided !== null) {
          game.endAt = decided;
          break;
        }

        let crossed = false;
        while (checkpoints.length > 0 && checkpoints[0]! <= now) {
          checkpoints.shift();
          crossed = true;
        }
        // A checkpoint changes what each player sees too (a new round, a revealed answer), not
        // just the public view: a player who hasn't acted since would otherwise keep a stale
        // view, such as last round's "no rolls left".
        if (crossed) await this.publishEverything(game, now);
        else await this.maybePublishPublic(game, now);

        const wake = Math.min(checkpoints[0] ?? game.endAt, game.endAt);
        const block = Math.max(1, Math.min(wake - now, MAX_BLOCK_MS));
        const entries = await this.reader.xread(
          "COUNT",
          READ_COUNT,
          "BLOCK",
          block,
          "STREAMS",
          sessionKeys.actions(this.sessionId),
          this.cursor,
        );
        if (entries) await this.log(game, entries);
      }

      // Everything appended before Redis's clock passed the end is in the stream by now.
      for (;;) {
        const entries = await this.reader.xread(
          "COUNT",
          READ_COUNT,
          "STREAMS",
          sessionKeys.actions(this.sessionId),
          this.cursor,
        );
        if (!entries) break;
        await this.log(game, entries);
      }
      return (await this.settle(game)) ? "settled" : "lost";
    } catch (error) {
      if (error instanceof Fenced) return "lost";
      throw error;
    } finally {
      this.reader.disconnect();
      await this.lease.release().catch(() => undefined);
    }
  }

  /** Loads the session and replays its logged actions to rebuild the game state. */
  private async load(): Promise<Game | null> {
    const { db, vault, lifecycle } = this.deps;
    const session = await db.gameSession.findUnique({ where: { id: this.sessionId } });
    if (!session || session.status !== "RUNNING" || session.mode !== "HOSTED") return null;

    const definition = findHostedGame(session.gameId, session.gameVersion);
    if (!definition) {
      await lifecycle.fail(this.sessionId, ["RUNNING"], "This worker cannot run the game");
      return null;
    }
    const config = definition.config.parse(session.config);
    const resources = await loadResources(db, definition.resources(config));
    const players = await lifecycle.players(this.sessionId, session.startedAt);
    const seed = vault.decrypt(session.seedCiphertext);
    const startAt = session.startsAt.getTime();
    const state = definition.init({
      config,
      players,
      startAt,
      rng: Rng.fromSeed(seed),
      resources: resourceMap(resources),
    });

    const logged = await db.sessionAction.findMany({
      where: { sessionId: this.sessionId },
      orderBy: { seq: "asc" },
    });
    if (logged.length !== session.actionCount) {
      throw new Error(
        `Session ${this.sessionId} logs ${logged.length} actions but counts ${session.actionCount}`,
      );
    }
    for (const row of logged) {
      definition.apply(state, definition.action.parse(row.action), {
        player: row.player as Address,
        seq: row.seq,
        at: row.at.getTime(),
      });
      this.seen.add(`${row.player}:${row.clientId}`);
    }
    this.seq = logged.length;
    this.cursor = session.lastStreamId;
    if (logged.length > 0) {
      this.deps.logger.log(
        `Session ${this.sessionId}: rebuilt from ${logged.length} logged actions`,
      );
    }

    return {
      definition,
      config,
      state,
      players,
      participants: new Set(players),
      startAt,
      endAt: startAt + definition.duration(config),
      seed,
      resources,
    };
  }

  /**
   * Whether a wallet may act. Games played in rounds take joins after the start, so a wallet
   * missing from the starting list is looked up once; the gateway only forwards participants.
   */
  private async isParticipant(game: Game, player: Address): Promise<boolean> {
    if (game.participants.has(player)) return true;
    if (game.definition.awards === undefined) return false;
    const row = await this.deps.db.sessionParticipant.findUnique({
      where: { sessionId_wallet: { sessionId: this.sessionId, wallet: player } },
      select: { wallet: true },
    });
    if (row) game.participants.add(player);
    return row !== null;
  }

  /** Sequences, logs and applies a batch of stream entries. */
  private async log(game: Game, entries: NonNullable<StreamEntries>): Promise<void> {
    const rows: Prisma.SessionActionCreateManyInput[] = [];
    const updates: PlayerUpdate[] = [];
    let last = this.cursor;

    for (const [, stream] of entries) {
      for (const [id, fields] of stream) {
        last = id;
        const entry = fieldsOf(fields);
        const player = entry.player?.toLowerCase() as Address | undefined;
        const clientId = entry.id;
        // The gateway checks all of this; the runtime does not trust it to.
        if (!player || !clientId || !(await this.isParticipant(game, player))) continue;
        const key = `${player}:${clientId}`;
        if (this.seen.has(key)) continue;
        const action = game.definition.action.safeParse(parseJson(entry.action));
        if (!action.success) continue;

        const at = Number(id.split("-")[0]);
        const outcome = game.definition.apply(game.state, action.data, {
          player,
          seq: this.seq,
          at,
        });
        rows.push({
          sessionId: this.sessionId,
          seq: this.seq,
          player,
          clientId,
          at: new Date(at),
          action: action.data as Prisma.InputJsonValue,
          accepted: outcome.accepted,
          reason: outcome.accepted ? null : outcome.reason,
        });
        updates.push({
          player,
          view: null,
          result: {
            id: clientId,
            seq: this.seq,
            accepted: outcome.accepted,
            ...(outcome.accepted ? {} : { reason: outcome.reason }),
          },
        });
        this.seen.add(key);
        this.seq += 1;
      }
    }

    const previous = this.cursor;
    await this.deps.db.$transaction(async (tx) => {
      if (rows.length > 0) await tx.sessionAction.createMany({ data: rows });
      const { count } = await tx.gameSession.updateMany({
        where: { id: this.sessionId, status: "RUNNING", lastStreamId: previous },
        data: { lastStreamId: last, actionCount: this.seq },
      });
      if (count !== 1) throw new Fenced();
    });
    this.cursor = last;

    if (updates.length > 0) {
      const now = await this.now();
      for (const update of updates) {
        update.view = game.definition.playerView(game.state, update.player, now);
      }
      await this.deps.bus.players(this.sessionId, updates);
      this.publicDirty = true;
    }
  }

  private async settle(game: Game): Promise<boolean> {
    const { db, bus, lifecycle } = this.deps;
    const ranking = game.definition.rank(game.state);
    const session = await db.gameSession.findUniqueOrThrow({
      where: { id: this.sessionId },
      include: { giveaway: { select: { contractAddress: true } } },
    });
    const actions = await db.sessionAction.findMany({
      where: { sessionId: this.sessionId },
      orderBy: { seq: "asc" },
      select: { seq: true, player: true, at: true, action: true },
    });

    const transcript = hostedTranscriptSchema.parse({
      v: 1,
      mode: "HOSTED",
      session: {
        id: session.id,
        chainId: session.chainId,
        contract: session.giveaway.contractAddress,
        giveawayId: session.giveawayId,
      },
      game: { id: session.gameId, version: session.gameVersion },
      config: game.config,
      seed: game.seed,
      startAt: game.startAt,
      endAt: game.endAt,
      players: game.players,
      resources: game.resources,
      actions: actions.map((a) => ({ ...a, at: a.at.getTime() })),
      ranking,
      awards: game.definition.awards?.(game.state),
    });

    const settled = await lifecycle.settle(
      { id: this.sessionId, lastStreamId: this.cursor },
      { transcript, ranking, seed: game.seed, endedAt: new Date() },
    );
    if (!settled) return false;

    await this.publishEverything(game, game.endAt);
    await bus.retire(this.sessionId);
    return true;
  }

  private async maybePublishPublic(game: Game, now: number): Promise<void> {
    if (!this.publicDirty || now - this.lastPublicAt < PUBLIC_VIEW_INTERVAL_MS) return;
    await this.deps.bus.publicView(this.sessionId, game.definition.publicView(game.state, now));
    this.publicDirty = false;
    this.lastPublicAt = now;
  }

  /** Publishes the public view and every player's view, e.g. after a rebuild. */
  private async publishEverything(game: Game, now: number): Promise<void> {
    const { bus } = this.deps;
    await bus.publicView(this.sessionId, game.definition.publicView(game.state, now));
    this.publicDirty = false;
    this.lastPublicAt = now;
    const everyone = [...game.participants];
    for (let i = 0; i < everyone.length; i += VIEW_PUBLISH_CHUNK) {
      await bus.players(
        this.sessionId,
        everyone.slice(i, i + VIEW_PUBLISH_CHUNK).map((player) => ({
          player,
          view: game.definition.playerView(game.state, player, now),
        })),
      );
    }
  }

  /** Redis's clock, which also stamps the action stream. */
  private async now(): Promise<number> {
    const [seconds, micros] = await this.deps.redis.time();
    return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  }
}

function fieldsOf(fields: string[]): Record<string, string | undefined> {
  const entry: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) entry[fields[i]!] = fields[i + 1]!;
  return entry;
}

function parseJson(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
