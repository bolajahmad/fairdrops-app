import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from "react";

export type IconName =
  | "check"
  | "clock"
  | "users"
  | "gift"
  | "volume"
  | "mute"
  | "sun"
  | "moon"
  | "monitor"
  | "arrow"
  | "spinner"
  | "alert"
  | "shield"
  | "lock"
  | "x"
  | "share"
  | "dice"
  | "quiz"
  | "tap"
  | "puzzle"
  | "back"
  | "menu"
  | "wallet"
  | "card"
  | "send"
  | "sparkles"
  | "scale"
  | "trophy"
  | "repeat"
  | "shuffle"
  | "chevron"
  | "minus"
  | "plus"
  | "copy"
  | "search";

export type GameKind = "dice" | "quiz" | "tap" | "custom";

export type PlayerStatus =
  | "upcoming"
  | "live"
  | "ending"
  | "settling"
  | "results"
  | "claimable"
  | "claimed"
  | "ended"
  | "cancelled"
  | "failed"
  | "unwon";

export interface IconProps {
  name: IconName;
  size?: number;
  spin?: boolean;
  className?: string;
}

export interface LogoProps {
  variant?: "full" | "mark" | "app";
  size?: number;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "flare";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
  block?: boolean;
}

export interface IconButtonProps {
  icon: IconName;
  label: string;
  tone?: "default" | "stage";
  pressed?: boolean;
  onClick?: () => void;
  className?: string;
}

export interface StatusChipProps {
  status: PlayerStatus;
  label?: string;
  onStage?: boolean;
}

export interface CountdownProps {
  seconds: number;
  running?: boolean;
  label?: string;
  size?: "s" | "m" | "l";
  urgentAt?: number;
  doneLabel?: string;
  onStage?: boolean;
}

export interface PrizeAmountProps {
  amount: string;
  symbol?: string;
  size?: "s" | "m" | "l" | "xl";
  note?: string;
  muted?: boolean;
}

export interface FairBadgeProps {
  state?: "pending" | "checking" | "verified" | "failed";
  label?: string;
  detail?: string;
  onClick?: () => void;
  href?: string;
}

export interface GiveawayCardData {
  host: string;
  hue?: number;
  title: string;
  pool: string;
  symbol: string;
  winners: number;
  /** The prize token's network, always shown with the amount. */
  network?: string;
  /** Shown as a badge when the prize token isn't verified. */
  trust?: "verified" | "listed" | "unverified";
  /** Omitted when unknown, rather than shown as a dash. */
  players?: string;
  status: PlayerStatus;
  seconds?: number;
  games: GameKind[];
}

export interface GiveawayCardProps {
  giveaway: GiveawayCardData;
  href?: string;
  onClick?: MouseEventHandler;
}

export interface LeaderboardRowProps {
  rank: number;
  name: string;
  score: string;
  prize?: string;
  symbol?: string;
  you?: boolean;
  hue?: number;
  delay?: number;
  onStage?: boolean;
}

export interface ClaimCardProps {
  state: "waiting" | "ready" | "collecting" | "collected" | "expired" | "none";
  rank?: number;
  amount?: string;
  symbol?: string;
  note?: string;
  deadline?: string;
  winners?: number;
  onCollect?: () => void;
  onShare?: () => void;
}

export interface GameStageProps {
  game: GameKind;
  title?: string;
  round?: string;
  seconds?: number;
  running?: boolean;
  sound?: boolean;
  onSoundChange?: (on: boolean) => void;
  className?: string;
  children?: ReactNode;
}

export interface TapTargetProps {
  count?: number;
  label?: string;
  hint?: string;
  disabled?: boolean;
  onTap?: (count: number) => void;
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
  suffix?: string;
}

export interface SegmentedOption {
  value: string;
  label: string;
  hint?: string;
  icon?: IconName;
  /** Shown but not selectable, with `badge` explaining why (e.g. "Coming soon"). */
  disabled?: boolean;
  badge?: string;
}

export interface SegmentedProps {
  label: string;
  options: SegmentedOption[];
  value?: string;
  onChange?: (value: string) => void;
  /** Full-width option cards, one per row. */
  stacked?: boolean;
  /** Icons only; labels stay available to screen readers and as tooltips. */
  compact?: boolean;
}

export interface ThemeSwitchProps {
  value?: "system" | "light" | "dark";
  onChange?: (value: "system" | "light" | "dark") => void;
  compact?: boolean;
}
