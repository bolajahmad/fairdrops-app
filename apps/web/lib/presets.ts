import {
  approvedTokens,
  BPS_DENOMINATOR,
  findChain,
  type RewardPolicy,
  type Token,
} from "@fairdrops/shared";

export type AudienceId = "community" | "followers" | "custom";
/** How the prize is shared. `random` is a weighted split drawn when the host publishes. */
export type RewardMode = "balanced" | "weighted" | "random";
export type GameChoice = "auto" | "pick";
export type StartChoice = "soon" | "tonight" | "pick";

export interface AudiencePreset {
  id: AudienceId;
  winners: number;
  reward: RewardMode;
  when: StartChoice;
  pool: string;
}

/** Client defaults for the host wizard. Expected to change often, so they live here only. */
export const audiencePresets: readonly AudiencePreset[] = [
  { id: "community", winners: 10, reward: "weighted", when: "tonight", pool: "250" },
  { id: "followers", winners: 3, reward: "balanced", when: "soon", pool: "100" },
  { id: "custom", winners: 5, reward: "balanced", when: "pick", pool: "50" },
];

/** A token a host can give away. Picking one also picks its network. */
export interface PrizeToken extends Token {
  key: string;
  chainName: string;
}

export const prizeTokens: readonly PrizeToken[] = approvedTokens
  .map((token) => {
    const chain = findChain(token.chainId);
    return chain && chain.environment === "testnet"
      ? { ...token, key: `${token.chainId}:${token.address}`, chainName: chain.name }
      : null;
  })
  .filter((token): token is PrizeToken => token !== null)
  // Stablecoins first: most hosts think in dollars.
  .sort((a, b) => Number(b.symbol === "USDC") - Number(a.symbol === "USDC"));

export const DEFAULT_TOKEN_KEY =
  prizeTokens.find((token) => token.symbol === "USDC" && token.chainId === 84532)?.key ??
  prizeTokens[0]!.key;

export function findPrizeToken(key: string): PrizeToken {
  return prizeTokens.find((token) => token.key === key) ?? prizeTokens[0]!;
}

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

export function startFromChoice(choice: StartChoice, picked: string): Date {
  const now = Date.now();
  if (choice === "soon") return new Date(now + 15 * 60 * 1000);
  if (choice === "pick" && picked) return new Date(picked);
  const tonight = new Date();
  tonight.setHours(20, 30, 0, 0);
  if (tonight.getTime() < now + 2 * 60 * 1000) tonight.setDate(tonight.getDate() + 1);
  return tonight;
}
