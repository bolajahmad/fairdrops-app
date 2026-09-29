import type { Address } from "@fairdrops/shared";
import type { Standing } from "../types.js";

/** How many standings public views show while a game runs. */
export const LEADERBOARD_SIZE = 10;

export interface LeaderboardEntry {
  player: Address;
  score: number;
  rank: number;
}

/** Orders lowercase addresses; the last tiebreak in every hosted game. */
export function compareAddresses(a: Address, b: Address): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function leaderboard(standings: Standing[], size = LEADERBOARD_SIZE): LeaderboardEntry[] {
  return standings.slice(0, size).map(({ player, score, rank }) => ({ player, score, rank }));
}
