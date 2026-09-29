import type { Address } from "@fairdrops/shared";
import { z } from "zod";
import type { Rng } from "../rng.js";
import type { ActionOutcome, HostedGame, Standing } from "../types.js";
import { compareAddresses, leaderboard, type LeaderboardEntry } from "./common.js";

export const diceConfigSchema = z.strictObject({
  /** Rolls each player gets. */
  rolls: z.number().int().min(1).max(10).default(3),
  /** Dice thrown per roll. */
  dice: z.number().int().min(1).max(5).default(2),
  sides: z.number().int().min(4).max(20).default(6),
  /** How long players have to use their rolls. */
  windowSeconds: z.number().int().min(30).max(900).default(120),
});
export type DiceConfig = z.infer<typeof diceConfigSchema>;

export const diceActionSchema = z.strictObject({ type: z.literal("roll") });
export type DiceAction = z.infer<typeof diceActionSchema>;

export interface DiceState {
  config: DiceConfig;
  startAt: number;
  endAt: number;
  rng: Rng;
  players: Set<Address>;
  rolls: Map<Address, number[][]>;
  /** Seeded tiebreak per player, drawn once at the start. */
  draws: Map<Address, number>;
}

export type DicePublicView =
  | { phase: "waiting"; startsAt: number }
  | {
      phase: "rolling" | "finished";
      endsAt: number;
      rolledPlayers: number;
      leaderboard: LeaderboardEntry[];
    };

export interface DicePlayerView {
  rolls: number[][];
  total: number;
  remaining: number;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * The value of each roll comes from its own stream, labelled by player and roll number, so it
 * does not depend on when anyone else rolls. Pressing roll only reveals a value the seed already
 * fixed, which is why the seed is committed on-chain before play and revealed afterwards.
 */
function throwDice(rng: Rng, player: Address, index: number, config: DiceConfig): number[] {
  const stream = rng.fork(`roll/${player}/${index}`);
  return Array.from({ length: config.dice }, () => stream.int(config.sides) + 1);
}

/** Highest total first, then the best single roll, then a seeded draw, then the address. */
function standings(state: DiceState): Standing[] {
  return [...state.players]
    .map((player) => {
      const rolls = state.rolls.get(player) ?? [];
      return {
        player,
        total: sum(rolls.map(sum)),
        best: Math.max(0, ...rolls.map(sum)),
        draw: state.draws.get(player)!,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.best - a.best ||
        b.draw - a.draw ||
        compareAddresses(a.player, b.player),
    )
    .map((entry, i) => ({ player: entry.player, score: entry.total, rank: i + 1 }));
}

export const dice: HostedGame<DiceConfig, DiceState, DiceAction, DicePublicView, DicePlayerView> = {
  id: "dice",
  version: "1.0.0",
  name: "Dice",
  description:
    "Each player rolls a set of dice a fixed number of times before the window closes. Highest " +
    "total wins. Every roll is derived from the committed seed, so results can be replayed.",
  config: diceConfigSchema,
  action: diceActionSchema,

  resources: () => [],
  check: () => [],
  duration: (config) => config.windowSeconds * 1000,
  checkpoints: (config, startAt) => [startAt, startAt + config.windowSeconds * 1000],

  init: ({ config, players, startAt, rng }) => ({
    config,
    startAt,
    endAt: startAt + config.windowSeconds * 1000,
    rng,
    players: new Set(players),
    rolls: new Map(),
    draws: new Map(players.map((player) => [player, rng.fork(`tiebreak/${player}`).uint32()])),
  }),

  apply(state, _action, ctx): ActionOutcome {
    if (!state.players.has(ctx.player)) return { accepted: false, reason: "Not a player" };
    if (ctx.at < state.startAt) return { accepted: false, reason: "The game has not started" };
    if (ctx.at >= state.endAt) return { accepted: false, reason: "The game is over" };
    const rolls = state.rolls.get(ctx.player) ?? [];
    if (rolls.length >= state.config.rolls) return { accepted: false, reason: "No rolls left" };

    rolls.push(throwDice(state.rng, ctx.player, rolls.length, state.config));
    state.rolls.set(ctx.player, rolls);
    return { accepted: true };
  },

  publicView(state, now): DicePublicView {
    if (now < state.startAt) return { phase: "waiting", startsAt: state.startAt };
    return {
      phase: now < state.endAt ? "rolling" : "finished",
      endsAt: state.endAt,
      rolledPlayers: state.rolls.size,
      leaderboard: leaderboard(standings(state)),
    };
  },

  playerView(state, player): DicePlayerView {
    const rolls = state.rolls.get(player) ?? [];
    return {
      rolls,
      total: sum(rolls.map(sum)),
      remaining: state.config.rolls - rolls.length,
    };
  },

  rank: standings,
};
