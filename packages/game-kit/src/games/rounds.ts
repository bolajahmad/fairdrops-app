import {
  contractLimits,
  MAX_PLAY_SECONDS,
  MAX_ROUNDS,
  type Address,
  type Hex,
} from "@fairdrops/shared";
import { z } from "zod";
import type { Rng } from "../rng.js";
import type {
  ActionOutcome,
  AnyHostedGame,
  Award,
  HostedGame,
  ResourceRef,
  Standing,
} from "../types.js";
import { compareAddresses } from "./common.js";

export const ROUNDS_GAME_ID = "rounds";
export const ROUNDS_GAME_VERSION = "1.0.0";

const gameRefSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
});

const roundsConfigShape = z.strictObject({
  /** The rotation: round `r` plays `games[r % games.length]`. */
  games: z.array(gameRefSchema).min(1).max(5),
  /** Paid places in the whole giveaway. */
  places: z.number().int().min(1).max(contractLimits.maxWinners),
  winnersPerRound: z.number().int().min(1).max(contractLimits.maxWinners),
  /** Rounds keep starting while they can end within this long after the start. */
  playSeconds: z.number().int().min(1).max(MAX_PLAY_SECONDS),
  cooldownSeconds: z.number().int().min(3).max(30).default(20),
  /** Null for no limit. */
  maxWinsPerPlayer: z.number().int().min(1).nullable().default(null),
  minScore: z.number().int().default(1),
});
export type RoundsConfig = z.infer<typeof roundsConfigShape>;

/** Join or leave between rounds. Anything else is an action in the current round's game. */
export const rosterActionSchema = z.strictObject({ roster: z.enum(["join", "leave"]) });
export type RosterAction = z.infer<typeof rosterActionSchema>;

interface Slot {
  game: AnyHostedGame;
  config: unknown;
  startAt: number;
  endAt: number;
}

interface Round {
  state: unknown;
  players: Set<Address>;
}

export interface RoundsState {
  config: RoundsConfig;
  startAt: number;
  rng: Rng;
  resources: ReadonlyMap<Hex, unknown>;
  schedule: Slot[];
  /** Everyone who started in the game, plus roster changes in log order. */
  initial: readonly Address[];
  roster: { at: number; player: Address; join: boolean }[];
  /** Rounds that have seen an action at or after their start, initialised then. */
  rounds: Map<number, Round>;
  /** Final rankings of rounds whose end an action has passed; frozen from then on. */
  finished: Map<number, Standing[]>;
}

export type RoundsPhase = "waiting" | "playing" | "break" | "over";

export interface RoundsPublicView {
  kind: "rounds";
  phase: RoundsPhase;
  /** The round being played, or the next one during a break, from 0. */
  round: number;
  /** Rounds that fit in the play time; fewer are played if every prize is won sooner. */
  maxRounds: number;
  /** When the play time is up. */
  playUntil: number;
  game: { id: string; version: string };
  /** Start and end of `round`. */
  startsAt: number;
  endsAt: number;
  /** The next round to start after now, if there is one: where late joiners come in. */
  next: { startsAt: number; game: { id: string; version: string } } | null;
  places: number;
  /** Places won so far, in order. */
  awards: Award[];
  winnersPerRound: number;
  maxWinsPerPlayer: number | null;
  /** In this round's game, during play; the last round's final view during a break. */
  view: unknown;
  /** The game shown by `view`, which during a break is the previous round's. */
  viewGame: { id: string; version: string } | null;
}

export interface RoundsPlayerView {
  kind: "rounds";
  /** Whether the player will be in the next round to start. */
  joined: boolean;
  /** Whether the player is in `round` (the one being played). */
  playing: boolean;
  wins: number;
  view: unknown;
}

/** Every round that ends within the play time, back to back with the breaks between them. */
function scheduleOf(
  config: RoundsConfig,
  startAt: number,
  find: (id: string, version: string) => AnyHostedGame | undefined,
): Slot[] {
  const slots: Slot[] = [];
  const until = startAt + config.playSeconds * 1000;
  let at = startAt;
  for (let r = 0; r < MAX_ROUNDS; r++) {
    const ref = config.games[r % config.games.length]!;
    const game = find(ref.id, ref.version)!;
    const sub = game.config.parse(ref.config);
    const endAt = at + game.duration(sub);
    if (endAt > until) break;
    slots.push({ game, config: sub, startAt: at, endAt });
    at = endAt + config.cooldownSeconds * 1000;
  }
  return slots;
}

/** Who is in a round: everyone on the roster just before it starts, sorted. */
function rosterAt(state: RoundsState, time: number): Address[] {
  const roster = new Set(state.initial);
  for (const change of state.roster) {
    if (change.at >= time) break;
    if (change.join) roster.add(change.player);
    else roster.delete(change.player);
  }
  return [...roster].sort(compareAddresses);
}

function initRound(state: RoundsState, r: number): Round {
  const slot = state.schedule[r]!;
  const players = rosterAt(state, slot.startAt);
  return {
    players: new Set(players),
    state: slot.game.init({
      config: slot.config,
      players,
      startAt: slot.startAt,
      rng: state.rng.fork(`round/${r}`),
      resources: state.resources,
    }),
  };
}

/** The round's state, without creating it: rounds nobody acted in are built on the fly. */
function peekRound(state: RoundsState, r: number): Round {
  return state.rounds.get(r) ?? initRound(state, r);
}

function rankingOf(state: RoundsState, r: number): Standing[] {
  const frozen = state.finished.get(r);
  if (frozen) return frozen;
  return state.schedule[r]!.game.rank(peekRound(state, r).state);
}

/**
 * Hands out places round by round, best first, skipping players below the minimum score or at
 * their win limit. `upTo` limits it to the rounds that have ended.
 */
function allocate(state: RoundsState, upTo: number): { awards: Award[]; decidedAt: number | null } {
  const { config } = state;
  const awards: Award[] = [];
  const wins = new Map<Address, number>();
  for (let r = 0; r < upTo && awards.length < config.places; r++) {
    let taken = 0;
    for (const standing of [...rankingOf(state, r)].sort((a, b) => a.rank - b.rank)) {
      if (taken >= config.winnersPerRound || awards.length >= config.places) break;
      if (standing.score < config.minScore) continue;
      const won = wins.get(standing.player) ?? 0;
      if (config.maxWinsPerPlayer !== null && won >= config.maxWinsPerPlayer) continue;
      awards.push({ round: r, player: standing.player, score: standing.score });
      wins.set(standing.player, won + 1);
      taken += 1;
    }
    if (awards.length >= config.places) {
      return { awards, decidedAt: state.schedule[r]!.endAt };
    }
  }
  return { awards, decidedAt: null };
}

/** Rounds that have ended by `now`. */
function endedBy(state: RoundsState, now: number): number {
  return state.schedule.filter((slot) => slot.endAt <= now).length;
}

/** Initialises rounds that started and freezes rounds that ended, as of an action at `at`. */
function advance(state: RoundsState, at: number): void {
  state.schedule.forEach((slot, r) => {
    if (slot.startAt <= at && !state.rounds.has(r)) state.rounds.set(r, initRound(state, r));
    if (slot.endAt <= at && !state.finished.has(r)) {
      state.finished.set(r, slot.game.rank(state.rounds.get(r)!.state));
    }
  });
}

/** The round at `now`: the one being played, or the next one during a break. */
function roundAt(state: RoundsState, now: number): { round: number; phase: RoundsPhase } {
  const { schedule } = state;
  if (now < schedule[0]!.startAt) return { round: 0, phase: "waiting" };
  for (let r = 0; r < schedule.length; r++) {
    const slot = schedule[r]!;
    if (now < slot.startAt) return { round: r, phase: "break" };
    if (now < slot.endAt) return { round: r, phase: "playing" };
  }
  return { round: schedule.length - 1, phase: "over" };
}

const ref = (game: AnyHostedGame) => ({ id: game.id, version: game.version });

/**
 * Rounds of other hosted games, played back to back with a short break, until every paid place
 * is won. Each round uses its own stream of the session seed (`round/<r>`), so one committed seed
 * covers every round, and the whole giveaway is one transcript that anyone can replay.
 *
 * Joining and leaving are logged actions, so replaying gives everyone the same rounds: a round's
 * players are those on the roster just before it starts.
 */
/** How many rounds fit in a rounds config's play time. */
export function roundCount(
  config: RoundsConfig,
  find: (id: string, version: string) => AnyHostedGame | undefined,
): number {
  return scheduleOf(config, 0, find).length;
}

export function createRoundsGame(
  find: (id: string, version: string) => AnyHostedGame | undefined,
): HostedGame<RoundsConfig, RoundsState, unknown, RoundsPublicView, RoundsPlayerView> {
  const config = roundsConfigShape.superRefine((value, ctx) => {
    value.games.forEach((choice, index) => {
      const game = find(choice.id, choice.version);
      if (!game) {
        ctx.addIssue({
          code: "custom",
          path: ["games", index],
          message: `${choice.id}@${choice.version} can't be played in rounds`,
        });
        return;
      }
      const parsed = game.config.safeParse(choice.config);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["games", index, "config"],
          message: `Invalid settings for ${choice.id}: ${parsed.error.issues[0]?.message ?? ""}`,
        });
      }
    });
    if (value.games.every((choice) => find(choice.id, choice.version))) {
      const first = find(value.games[0]!.id, value.games[0]!.version)!;
      const parsed = first.config.safeParse(value.games[0]!.config);
      if (parsed.success && first.duration(parsed.data) > value.playSeconds * 1000) {
        ctx.addIssue({
          code: "custom",
          path: ["playSeconds"],
          message: "The play time is shorter than one round",
        });
      }
    }
    if (value.winnersPerRound > value.places) {
      ctx.addIssue({
        code: "custom",
        path: ["winnersPerRound"],
        message: "A round can't award more places than the giveaway has",
      });
    }
  });

  return {
    id: ROUNDS_GAME_ID,
    version: ROUNDS_GAME_VERSION,
    name: "Rounds",
    description:
      "Rounds of FairDrops games, back to back, until every prize is won. Each round awards the " +
      "next places to its best players. People can join or leave between rounds.",
    config,
    action: z.union([rosterActionSchema, z.record(z.string(), z.unknown())]),

    resources(value) {
      const seen = new Map<Hex, ResourceRef>();
      for (const choice of value.games) {
        const game = find(choice.id, choice.version)!;
        for (const resource of game.resources(game.config.parse(choice.config))) {
          seen.set(resource.hash, resource);
        }
      }
      return [...seen.values()];
    },

    check(value, resources) {
      return value.games.flatMap((choice) => {
        const game = find(choice.id, choice.version)!;
        return game.check(game.config.parse(choice.config), resources);
      });
    },

    duration(value) {
      return scheduleOf(value, 0, find).at(-1)?.endAt ?? 0;
    },

    checkpoints(value, startAt) {
      return scheduleOf(value, startAt, find).flatMap((slot) => [
        slot.startAt,
        ...slot.game.checkpoints(slot.config, slot.startAt),
        slot.endAt,
      ]);
    },

    init: ({ config: value, players, startAt, rng, resources }) => ({
      config: value,
      startAt,
      rng,
      resources,
      schedule: scheduleOf(value, startAt, find),
      initial: [...players],
      roster: [],
      rounds: new Map(),
      finished: new Map(),
    }),

    apply(state, action, ctx): ActionOutcome {
      advance(state, ctx.at);
      const roster = rosterActionSchema.safeParse(action);
      if (roster.success) {
        state.roster.push({ at: ctx.at, player: ctx.player, join: roster.data.roster === "join" });
        return { accepted: true };
      }

      const { round, phase } = roundAt(state, ctx.at);
      if (phase !== "playing") {
        return {
          accepted: false,
          reason: phase === "over" ? "The game is over" : "Between rounds",
        };
      }
      if (allocate(state, round).awards.length >= state.config.places) {
        return { accepted: false, reason: "Every prize has been won" };
      }
      const current = state.rounds.get(round)!;
      if (!current.players.has(ctx.player)) {
        return { accepted: false, reason: "You'll be in the next round" };
      }
      const slot = state.schedule[round]!;
      const parsed = slot.game.action.safeParse(action);
      if (!parsed.success) return { accepted: false, reason: "Not an action in this round's game" };
      return slot.game.apply(current.state, parsed.data, ctx);
    },

    publicView(state, now): RoundsPublicView {
      const { awards } = allocate(state, endedBy(state, now));
      const decided = awards.length >= state.config.places;
      // Once every place is won, the game stays on the round that decided it.
      const at = roundAt(state, now);
      const round = decided ? awards.at(-1)!.round : at.round;
      const phase: RoundsPhase = decided ? "over" : at.phase;
      const slot = state.schedule[round]!;
      const shown =
        phase === "playing" || phase === "over" ? round : phase === "waiting" ? null : round - 1;
      return {
        kind: "rounds",
        phase,
        round,
        maxRounds: state.schedule.length,
        playUntil: state.startAt + state.config.playSeconds * 1000,
        game: ref(slot.game),
        startsAt: slot.startAt,
        endsAt: slot.endAt,
        next: (() => {
          if (phase === "over") return null;
          const upcoming = state.schedule.find((candidate) => candidate.startAt > now);
          return upcoming ? { startsAt: upcoming.startAt, game: ref(upcoming.game) } : null;
        })(),
        places: state.config.places,
        awards,
        winnersPerRound: state.config.winnersPerRound,
        maxWinsPerPlayer: state.config.maxWinsPerPlayer,
        view:
          shown === null || shown < 0
            ? null
            : state.schedule[shown]!.game.publicView(peekRound(state, shown).state, now),
        viewGame: shown === null || shown < 0 ? null : ref(state.schedule[shown]!.game),
      };
    },

    playerView(state, player, now): RoundsPlayerView {
      const { round, phase } = roundAt(state, now);
      const roster = rosterAt(state, Number.POSITIVE_INFINITY);
      const { awards } = allocate(state, endedBy(state, now));
      const current = phase === "playing" ? peekRound(state, round) : null;
      const playing = current?.players.has(player) ?? false;
      return {
        kind: "rounds",
        joined: roster.includes(player),
        playing,
        wins: awards.filter((award) => award.player === player).length,
        view:
          current && playing
            ? state.schedule[round]!.game.playerView(current.state, player, now)
            : null,
      };
    },

    /** Players by places won, then total score across rounds, then address. */
    rank(state) {
      const { awards } = allocate(state, state.schedule.length);
      const totals = new Map<Address, { wins: number; score: number }>();
      for (const player of rosterAt(state, Number.POSITIVE_INFINITY)) {
        totals.set(player, { wins: 0, score: 0 });
      }
      state.schedule.forEach((_, r) => {
        for (const standing of rankingOf(state, r)) {
          const total = totals.get(standing.player) ?? { wins: 0, score: 0 };
          total.score += standing.score;
          totals.set(standing.player, total);
        }
      });
      for (const award of awards) totals.get(award.player)!.wins += 1;
      return [...totals]
        .sort(([a, x], [b, y]) => y.wins - x.wins || y.score - x.score || compareAddresses(a, b))
        .map(([player, total], i) => ({ player, score: total.score, rank: i + 1 }));
    },

    awards: (state) => allocate(state, state.schedule.length).awards,

    decidedAt(state, now) {
      const { decidedAt } = allocate(state, endedBy(state, now));
      return decidedAt !== null && decidedAt <= now ? decidedAt : null;
    },
  };
}
