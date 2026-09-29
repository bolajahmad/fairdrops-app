import type { Address, Hex } from "@fairdrops/shared";
import type { z } from "zod";
import type { Rng } from "./rng.js";

/** Content a game needs besides its config, such as a quiz's question bank. */
export interface ResourceRef {
  kind: string;
  /** keccak256 of the canonical JSON of the content. */
  hash: Hex;
}

export interface GameInit<Config> {
  config: Config;
  /** Everyone who joined before the start, lowercase and sorted. Fixed for the whole game. */
  players: readonly Address[];
  /** Unix milliseconds. Every time a game sees is on this clock. */
  startAt: number;
  rng: Rng;
  /** The resources named by `resources(config)`, parsed, keyed by hash. */
  resources: ReadonlyMap<Hex, unknown>;
}

export interface ActionContext {
  player: Address;
  /** Position in the session's action log, from 0. */
  seq: number;
  /** When the action reached FairDrops, in Unix milliseconds. */
  at: number;
}

export type ActionOutcome = { accepted: true } | { accepted: false; reason: string };

export interface Standing {
  player: Address;
  /** Higher is better. Integer, so transcripts hash the same everywhere. */
  score: number;
  /** 1 for the winner. Ties are always broken, so ranks are unique. */
  rank: number;
}

/**
 * A game FairDrops runs itself. It must be deterministic: given the same config, players,
 * start time, seed, resources and action log, every function returns the same result on every
 * machine. That is what lets anyone replay a published transcript and check the winners.
 *
 * Rules for implementations:
 * - Randomness comes only from `init.rng` and its forks.
 * - Time comes only from `startAt`, `ctx.at` and the `now` passed to views. Phases are pure
 *   functions of time, so the runtime never has to log clock ticks.
 * - `apply` may mutate `state`, and must reject rather than throw on invalid input.
 * - Scores are integers and `rank` breaks every tie.
 */
export interface HostedGame<Config, State, Action, PublicView, PlayerView> {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  /** Validates the host's settings from the giveaway metadata and applies defaults. */
  readonly config: z.ZodType<Config>;
  /** Validates one player action as sent by a client. */
  readonly action: z.ZodType<Action>;

  resources(config: Config): ResourceRef[];
  /** Problems that make this config unplayable with these resources, e.g. too few questions. */
  check(config: Config, resources: ReadonlyMap<Hex, unknown>): string[];
  /** Milliseconds from start to end. Actions after the end are not accepted. */
  duration(config: Config): number;
  /** Times at which the public view changes without any action, e.g. the next question. */
  checkpoints(config: Config, startAt: number): number[];

  init(init: GameInit<Config>): State;
  apply(state: State, action: Action, ctx: ActionContext): ActionOutcome;
  /** What anyone watching may see at `now`. Never includes hidden information. */
  publicView(state: State, now: number): PublicView;
  /** What one player may see at `now`. */
  playerView(state: State, player: Address, now: number): PlayerView;
  /** Final standings, best first. */
  rank(state: State): Standing[];
}

/** A resource kind a game can ask for, with how to validate uploaded content. */
export interface ResourceKind<Content> {
  readonly kind: string;
  readonly schema: z.ZodType<Content>;
  /** Short, non-secret description for listings, e.g. "40 questions". */
  summary(content: Content): string;
}

// Method syntax keeps parameters bivariant, so any concrete game fits the registry type.
export type AnyHostedGame = HostedGame<unknown, unknown, unknown, unknown, unknown>;
