import { BPS_DENOMINATOR, type RewardPolicy } from "@fairdrops/shared";

export type AudienceId = "community" | "followers" | "custom";
/** How the prize is shared. `random` is a weighted split drawn when the host publishes. */
export type RewardMode = "balanced" | "weighted" | "random";
export type GameChoice = "auto" | "pick";
export type StartChoice = "soon" | "later" | "evening" | "pick";
/** One game everyone plays once, or rounds until every prize is won. */
export type PlayMode = "once" | "rounds";

/** The per-person win limit hosts start from. */
export const DEFAULT_MAX_WINS = 3;
/** Seconds between rounds, when people can join or leave. */
export const DEFAULT_ROUND_BREAK_SECONDS = 10;

/** How long a rounds giveaway keeps playing, in minutes: the host's choices. */
export const PLAY_TIMES = [15, 30, 60, 180] as const;
export type PlayMinutes = (typeof PLAY_TIMES)[number];
export const DEFAULT_PLAY_MINUTES: PlayMinutes = 30;

/** "15 min", "1 hour", "3 hours". */
export function playTimeLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export interface AudiencePreset {
  id: AudienceId;
  winners: number;
  reward: RewardMode;
  when: StartChoice;
  pool: string;
}

/** Client defaults for the host wizard. Expected to change often, so they live here only. */
export const audiencePresets: readonly AudiencePreset[] = [
  { id: "community", winners: 10, reward: "weighted", when: "evening", pool: "250" },
  { id: "followers", winners: 3, reward: "balanced", when: "soon", pool: "100" },
  { id: "custom", winners: 5, reward: "balanced", when: "pick", pool: "50" },
];

/** Shares fall in a straight line from first place to last. */
export function weightedBps(places: number): number[] {
  const count = Math.max(1, places);
  const weights = Array.from({ length: count }, (_, index) => count - index);
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const shares = weights.map((weight) => Math.max(1, Math.floor((weight * BPS_DENOMINATOR) / sum)));
  shares[0] = shares[0]! + BPS_DENOMINATOR - shares.reduce((total, share) => total + share, 0);
  return shares;
}

/**
 * A surprise split: every place gets a random share, at least 1%. It is drawn once, before
 * publishing, and committed on-chain with the giveaway, so it is as checkable as any other split.
 */
export function randomBps(places: number): number[] {
  const count = Math.max(1, places);
  const floor = Math.min(100, Math.floor(BPS_DENOMINATOR / count));
  const spare = BPS_DENOMINATOR - floor * count;
  const draws = new Uint32Array(count);
  crypto.getRandomValues(draws);
  const total = draws.reduce((sum, value) => sum + value, 0) || 1;
  const shares = Array.from(draws, (value) => floor + Math.floor((value / total) * spare));
  shares[0] = shares[0]! + BPS_DENOMINATOR - shares.reduce((sum, share) => sum + share, 0);
  return shares;
}

export function rewardPolicy(mode: RewardMode, winners: number, drawn: number[]): RewardPolicy {
  if (mode === "balanced") return { kind: "equal", winners, minScore: 1 };
  if (mode === "random") return { kind: "weighted", bps: drawn, minScore: 1 };
  return { kind: "weighted", bps: weightedBps(winners), minScore: 1 };
}

const EVENING_HOUR = 20;
const EVENING_MINUTE = 30;
/** The evening slot is only offered for today while it's at least this far away. */
const EVENING_LEAD_MS = 60 * 60 * 1000;

/** 20:30 today if that's still an hour away, otherwise 20:30 tomorrow. */
export function eveningSlot(now = new Date()): { at: Date; tomorrow: boolean } {
  const at = new Date(now);
  at.setHours(EVENING_HOUR, EVENING_MINUTE, 0, 0);
  if (at.getTime() - now.getTime() >= EVENING_LEAD_MS) return { at, tomorrow: false };
  at.setDate(at.getDate() + 1);
  return { at, tomorrow: true };
}

/** A datetime-local value (YYYY-MM-DDTHH:mm) in the viewer's time zone. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** When the giveaway starts for a choice, always in the future. */
export function startFromChoice(choice: StartChoice, picked: string, now = new Date()): Date {
  if (choice === "soon") return new Date(now.getTime() + 15 * 60 * 1000);
  if (choice === "later") return new Date(now.getTime() + 2 * 60 * 60 * 1000);
  if (choice === "pick" && picked) return new Date(picked);
  if (choice === "pick") return new Date(now.getTime() + 60 * 60 * 1000);
  return eveningSlot(now).at;
}
