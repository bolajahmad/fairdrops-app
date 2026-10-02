import { z } from "zod";
import { addressSchema, chainIdSchema, isoDateTimeSchema, uint256Schema } from "./primitives.js";
import { tokenViewSchema } from "./tokens.js";

/** One token an account won or gave, summed over finalized giveaways. */
export const leaderboardAmountSchema = z.object({
  chainId: chainIdSchema,
  token: addressSchema,
  amount: uint256Schema,
  /** Null when the token couldn't be read; the amount is then in raw units. */
  tokenInfo: tokenViewSchema.nullable(),
});
export type LeaderboardAmount = z.infer<typeof leaderboardAmountSchema>;

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  account: addressSchema,
  /** Prizes won, or giveaways that paid out. */
  count: z.number().int().nonnegative(),
  /** Approximate USDT across the priced tokens; unpriced tokens count as zero. */
  value: z.number().nonnegative(),
  amounts: z.array(leaderboardAmountSchema),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

/**
 * `GET /leaderboards`: all time, from finalized giveaways only, so a board changes when a
 * giveaway's result is final, never while it is played. Ranked by approximate USDT value, then
 * by count.
 */
export const leaderboardsViewSchema = z.object({
  winners: z.array(leaderboardEntrySchema),
  hosts: z.array(leaderboardEntrySchema),
  updatedAt: isoDateTimeSchema,
});
export type LeaderboardsView = z.infer<typeof leaderboardsViewSchema>;
