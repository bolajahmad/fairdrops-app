import type * as React from "react";

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
  | "puzzle";
export type GameKind = "dice" | "quiz" | "tap" | "custom";
/** Player-facing phase, mapped from the API's giveaway / session / settlement status. */
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
  | "failed";

export interface IconProps {
  name: IconName;
  size?: number;
  spin?: boolean;
  className?: string;
}
export declare function Icon(props: IconProps): React.ReactElement;

export interface LogoProps {
  variant?: "full" | "mark" | "app";
  size?: number;
}
export declare function Logo(props: LogoProps): React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "flare";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
  block?: boolean;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface IconButtonProps {
  icon: IconName;
  label: string;
  tone?: "default" | "stage";
  pressed?: boolean;
  onClick?: () => void;
  className?: string;
}
export declare function IconButton(props: IconButtonProps): React.ReactElement;

export interface StatusChipProps {
  status: PlayerStatus;
  label?: string;
  onStage?: boolean;
}
export declare function StatusChip(props: StatusChipProps): React.ReactElement;

export interface CountdownProps {
  seconds: number;
  running?: boolean;
  label?: string;
  size?: "s" | "m" | "l";
  urgentAt?: number;
  doneLabel?: string;
  onStage?: boolean;
}
export declare function Countdown(props: CountdownProps): React.ReactElement;

export interface PrizeAmountProps {
  amount: string;
  symbol?: string;
  size?: "s" | "m" | "l" | "xl";
  note?: string;
  muted?: boolean;
}
export declare function PrizeAmount(props: PrizeAmountProps): React.ReactElement;

export interface FairBadgeProps {
  state?: "pending" | "checking" | "verified" | "failed";
  label?: string;
  detail?: string;
  onClick?: () => void;
}
export declare function FairBadge(props: FairBadgeProps): React.ReactElement;

export interface GiveawayCardData {
  host: string;
  hue?: number;
  title: string;
  pool: string;
  symbol: string;
  winners: number;
  players: string;
  status: PlayerStatus;
  seconds?: number;
  games: GameKind[];
}
export interface GiveawayCardProps {
  giveaway: GiveawayCardData;
  href?: string;
  onClick?: React.MouseEventHandler;
}
export declare function GiveawayCard(props: GiveawayCardProps): React.ReactElement;

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
export declare function LeaderboardRow(props: LeaderboardRowProps): React.ReactElement;

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
export declare function ClaimCard(props: ClaimCardProps): React.ReactElement;

export interface GameStageProps {
  game: GameKind;
  title?: string;
  round?: string;
  seconds?: number;
  running?: boolean;
  sound?: boolean;
  onSoundChange?: (on: boolean) => void;
  className?: string;
  children?: React.ReactNode;
}
export declare function GameStage(props: GameStageProps): React.ReactElement;

export interface TapTargetProps {
  count?: number;
  label?: string;
  hint?: string;
  disabled?: boolean;
  onTap?: (count: number) => void;
}
export declare function TapTarget(props: TapTargetProps): React.ReactElement;

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
  suffix?: string;
}
export declare function Field(props: FieldProps): React.ReactElement;

export interface SegmentedOption {
  value: string;
  label: string;
  hint?: string;
  icon?: IconName;
}
export interface SegmentedProps {
  label: string;
  options: SegmentedOption[];
  value?: string;
  onChange?: (value: string) => void;
  stacked?: boolean;
}
export declare function Segmented(props: SegmentedProps): React.ReactElement;

export interface ThemeSwitchProps {
  value?: "system" | "light" | "dark";
  onChange?: (value: "system" | "light" | "dark") => void;
}
export declare function ThemeSwitch(props: ThemeSwitchProps): React.ReactElement;

declare global {
  interface Window {
    FairDrops: {
      Icon: typeof Icon;
      Logo: typeof Logo;
      Button: typeof Button;
      IconButton: typeof IconButton;
      StatusChip: typeof StatusChip;
      Countdown: typeof Countdown;
      PrizeAmount: typeof PrizeAmount;
      FairBadge: typeof FairBadge;
      GiveawayCard: typeof GiveawayCard;
      LeaderboardRow: typeof LeaderboardRow;
      ClaimCard: typeof ClaimCard;
      GameStage: typeof GameStage;
      TapTarget: typeof TapTarget;
      Field: typeof Field;
      Segmented: typeof Segmented;
      ThemeSwitch: typeof ThemeSwitch;
    };
  }
}
