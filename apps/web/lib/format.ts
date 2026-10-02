import type { GiveawayPhase, GiveawayView, RewardPolicy } from "@fairdrops/shared";
import { formatUnits } from "viem";
import type { PlayerStatus } from "@/components/types";

export function formatTokenAmount(amount: string, decimals: number, locale?: string): string {
  const raw = formatUnits(BigInt(amount), decimals);
  const [whole = "0", fraction = ""] = raw.split(".");
  // For reading only: at most 4 decimals. Exact amounts live on-chain and in the proofs.
  const significant = fraction.slice(0, 4).replace(/0+$/, "");
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(whole));
  return significant ? `${grouped}.${significant}` : grouped;
}

export function formatCountdown(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}h`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function secondsBetween(nowMs: number, iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - nowMs) / 1000));
}

export function shortenWallet(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatWhen(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

const ENDING_MS = 10 * 60 * 1000;

/**
 * What a giveaway means to a player now. A session that FAILED leaves the on-chain phase at
 * "live" until the giveaway is unwound, so it is checked first.
 */
export function giveawayStatus(
  giveaway: Pick<GiveawayView, "phase" | "session">,
  options: Parameters<typeof statusFromPhase>[1] = {},
): PlayerStatus | null {
  // Ending with nobody playing or winning isn't a failure: the prize simply goes back.
  if (giveaway.session?.noWinners) return "unwon";
  if (giveaway.session?.status === "FAILED") return "failed";
  if (giveaway.session?.status === "CANCELLED") return "cancelled";
  return statusFromPhase(giveaway.phase, options);
}

export function statusFromPhase(
  phase: GiveawayPhase,
  options: { endsAtMs?: number; nowMs?: number; won?: boolean; claimed?: boolean } = {},
): PlayerStatus | null {
  switch (phase) {
    case "invalid":
      return null;
    case "upcoming":
      return "upcoming";
    case "live":
      if (
        options.endsAtMs !== undefined &&
        options.nowMs !== undefined &&
        options.endsAtMs - options.nowMs < ENDING_MS &&
        options.endsAtMs > options.nowMs
      ) {
        return "ending";
      }
      return "live";
    case "settling":
      return "settling";
    case "claimable":
      if (options.claimed) return "claimed";
      if (options.won) return "claimable";
      return "results";
    case "closed":
      return options.claimed ? "claimed" : "ended";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "failed";
    default: {
      const neverPhase: never = phase;
      return neverPhase;
    }
  }
}

export function placeAmounts(prize: bigint, rewards: RewardPolicy): bigint[] {
  if (rewards.kind === "equal") {
    const share = prize / BigInt(rewards.winners);
    return Array.from({ length: rewards.winners }, () => share);
  }
  return rewards.bps.map((bps) => (prize * BigInt(bps)) / 10_000n);
}

/**
 * Decimals for display. The API always sends `tokenInfo` unless the token could not be read at
 * all; then amounts are shown in the token's raw units (0 decimals), never with a guessed scale.
 * Never use this to build a transaction: require `tokenInfo` instead.
 */
export function tokenDecimals(item: Pick<GiveawayView, "tokenInfo">): number {
  return item.tokenInfo?.decimals ?? 0;
}

export function tokenSymbol(item: Pick<GiveawayView, "tokenInfo" | "token">): string {
  return item.tokenInfo?.symbol ?? `units of ${shortenWallet(item.token)}`;
}
