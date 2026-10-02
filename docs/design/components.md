# Components

The 15 FairDrops components, in the order they appear in the design system. Each section has the guidelines, then the props. A working implementation of every component is in [reference/bundle.js](reference/bundle.js) (styles: [reference/bundle.css](reference/bundle.css)), where class names are prefixed `fd-`.

When building `apps/web`:

- Rebuild each one as a typed React component on shadcn/Radix primitives where one fits. For example, `Segmented` is a Radix RadioGroup and the join sheet is a Radix Dialog or a Vaul drawer.
- Keep the names, props and states below.

Shared types:

```ts
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
```

## Logo

A drop landing in cupped hands: the prize reaching the player. Use `variant="full"` (the default) in the app bar and on marketing pages, `"mark"` where the space is under 120px wide, and `"app"` for favicons, the home-screen icon and social avatars.

- The consumer provides `size`, the mark's height in px. The wordmark scales with it.
- The drop is always `lagoon` and the hands are always `ink`. They follow the theme, so do not recolour them.
- Minimum size is 16px for the mark and 20px for the full logo. Leave clear space of half the mark's height on every side.
- Never add "FD" monograms, outlines, gradients or drop shadows. Never set the wordmark in another face.

```ts
export interface LogoProps {
  variant?: "full" | "mark" | "app";
  size?: number;
}
```

## Button

An arcade key: a solid face on a 4px press edge (`edge-*` shadows). When pressed, the face drops onto the edge. Every tap should feel like pressing a real button.

- **primary** (lagoon): the one thing the screen is for, such as Join, Collect prize or Create giveaway. Use at most one per view.
- **secondary**: the alternatives, such as View details or Share.
- **ghost**: low-weight links inside cards, such as How it works.
- **danger**: destructive host actions only (Cancel giveaway). Always put a confirmation sheet behind it.
- **flare**: reserved for the game stage (a Tap Rush start). Never use it for money.
- The consumer provides `children` (a verb first, sentence case: "Collect prize", not "Claim Now!"), plus optional `icon`, `iconAfter`, `size` (`sm` 36, `md` 48, `lg` 56) and `block`.
- `loading` keeps the label, swaps the icon for a spinner and blocks double taps. Use it for every chain action.
- A disabled button should say why ("Starts in 2:00"), not just grey out.
- On mobile, primary actions in play and claim flows are `lg` and `block`, in a sticky bottom bar.

```ts
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "flare";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
  block?: boolean;
}
```

## IconButton

A 44px round button that holds only an icon. Use it for share, close, sound and menus.

- The consumer provides `icon` and `label`. The label is required: it becomes the accessible name and the tooltip.
- Use `tone="stage"` on game stages.
- Use `pressed` for toggles, such as the sound toggle.

```ts
export interface IconButtonProps {
  icon: IconName;
  label: string;
  tone?: "default" | "stage";
  pressed?: boolean;
  onClick?: () => void;
  className?: string;
}
```

## StatusChip

Shows where a giveaway or game is, in player words. The API gives each giveaway a `phase` (`GiveawayView.phase`, from `deriveGiveawayPhase` in `@fairdrops/shared`). Map it like this:

| status      | when                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `upcoming`  | phase `upcoming`                                                                                  |
| `live`      | phase `live`                                                                                      |
| `ending`    | phase `live`, with under 10 minutes left in the game window                                       |
| `settling`  | phase `settling` (session `SETTLING` or `FINALIZING`)                                             |
| `results`   | phase `claimable` or `closed`, viewer did not win                                                 |
| `claimable` | phase `claimable`, viewer won, `ClaimView.claimedAt` is null                                      |
| `claimed`   | the viewer's `ClaimView.claimedAt` is set                                                         |
| `ended`     | phase `closed` (claim window over)                                                                |
| `cancelled` | phase `cancelled`: the host cancelled and was refunded                                            |
| `unwon`     | `GiveawayView.session.noWinners`: nobody played or scored enough; the prize went back to the host |
| `failed`    | phase `expired`, or session `FAILED`: no result, and the host is refunded                         |

- A giveaway in phase `invalid` never shows in discovery.
- Flare is reserved for `live` and `ending`, the only "hurry" states.
- `claimable` is the only solid chip. It pops in with `ease-spring`.
- The consumer can override `label`, for example "Starts Fri 8pm".
- The chip is always one line, 28px tall. Built-in labels are one or two words ("Counting", "Cancelled", "Void"); a longer label is truncated with "…" and never wraps. The full meaning ("Cancelled, and the host got the prize back") is the chip's tooltip and is read by screen readers.
- Never show raw phase or status names to players.

```ts
export interface StatusChipProps {
  status: PlayerStatus;
  label?: string;
  onStage?: boolean;
}
```

## Countdown

A tabular mono timer.

- In the last `urgentAt` seconds (default 10) it turns flare and ticks with a spring.
- Formats: `2d 04h` over a day, `1:04:09` over an hour, `04:09` otherwise.
- The consumer provides `seconds` computed from the **server clock**: use `LiveConnection.clockOffsetMs` from the SDK, never `Date.now()` alone.
- Also provide `running`, and optionally `label`, `size` (`s` `m` `l`) and `doneLabel`.
- Use `size="l"` only on the game stage and in the lobby.

```ts
export interface CountdownProps {
  seconds: number;
  running?: boolean;
  label?: string;
  size?: "s" | "m" | "l";
  urgentAt?: number;
  doneLabel?: string;
  onStage?: boolean;
}
```

## PrizeAmount

Money is always lagoon, in the display face with tabular figures, followed by its token symbol.

- The consumer provides a formatted `amount`. Use `Intl.NumberFormat` for the viewer's locale and trim trailing zeros past 2 decimals.
- Also provide the `symbol`, and an optional `note` for a local-currency estimate. Label estimates with "≈"; never present them as exact.
- Sizes: `xl` for the win reveal and claim, `l` for the giveaway card, `m` for rows, `s` for tables.
- Use `muted` for amounts that are not the player's, such as the host's refund.
- Never show raw wei and never show the chain name here. The chain belongs in Details.

```ts
export interface PrizeAmountProps {
  amount: string;
  symbol?: string;
  size?: "s" | "m" | "l" | "xl";
  note?: string;
  muted?: boolean;
}
```

## FairBadge

The quiet proof. Every result, prize and payout carries one. Tapping it opens the Verify sheet. That sheet runs `verifyGiveaway()` from `@fairdrops/sdk/verify` **in the browser** and lists each check in plain words:

- scores replayed;
- winners match;
- prize split matches;
- payment recorded.

- The consumer provides `state` and `onClick`, plus an optional `detail`.
- `pending` before settlement; `checking` while the SDK verifies; `verified` when every check passes; `failed` if any check fails. For `failed`, show which check and a link to the report.
- Fairness is a detail you can open, not a headline: one badge per result, never a banner.

```ts
export interface FairBadgeProps {
  state?: "pending" | "checking" | "verified" | "failed";
  label?: string;
  detail?: string;
  onClick?: () => void;
}
```

## GiveawayCard

One giveaway in a feed or grid. It shows, top to bottom:

- the host;
- the status;
- the title;
- the prize pool and number of winners;
- the games (as stage-coloured squares, so players can see the game mix);
- the players and the countdown.

- The consumer provides `giveaway`: `{host, hue, title, pool, symbol, winners, players, status, seconds?, games[]}`, plus `href` or `onClick`.
- The title comes from the host and may contain emoji. Allow two lines, and balance them.
- Use a grid with `minmax(260px, 1fr)` columns. On phones, one column.

```ts
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
```

## LeaderboardRow

One place on a leaderboard, laid out as rank, avatar, name, score and prize.

- The top three show the rank in lagoon.
- The viewer's own row is tinted and tagged "You".
- Rows rise in one after another with `delay`, 80ms apart, during the results reveal.
- The consumer provides `rank`, `name` (a display name or handle; a wallet only as a last resort, shortened `0x9f3c…a21b`), `score`, and optional `prize`, `symbol`, `you`, `hue`, `delay` and `onStage`.
- Render the rows inside an `<ol>`.
- The same row serves the "Top hosts" and "Top earners" boards; there, `score` is the total given or won.

```ts
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
```

## ClaimCard

The prize, and the one action that matters after a game. It covers six states:

- `waiting`: settling. Shows the FairBadge in `checking`.
- `ready`: the player won. The card has a lagoon ring and a big Collect button.
- `collecting`: the transaction is in flight. The button stays busy and the copy says to keep the page open.
- `collected`: offers Share win and the verified badge.
- `expired`: the claim deadline has passed.
- `none`: the player took part but did not win.

- The consumer provides `state`, `rank`, `amount`, `symbol`, optional `note`, `deadline` (a formatted date), `winners`, `onCollect` and `onShare`.
- With relaying on (the backend default), the worker claims every prize for its winner after finalization. The card goes from `waiting` straight to `collecting` and then `collected`, with no button. `ready` and its Collect button (a self-claim through `claimPrize` from `@fairdrops/sdk/claims`) are the fallback when relaying is off or late.
- The copy never mentions gas, signatures or networks.
- Put the card in a sticky bottom sheet on mobile.

```ts
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
```

## GameStage

The frame every game plays in, first-party or third-party. **Each game kind gets its own dark ground and pattern:**

| game   | ground         | pattern        |
| ------ | -------------- | -------------- |
| dice   | `stage-dice`   | pips           |
| quiz   | `stage-quiz`   | diagonal lines |
| tap    | `stage-tap`    | rings          |
| custom | `stage-custom` | dots           |

When a giveaway moves to its next game, the whole screen changes ground (over `duration-reveal`), so players notice.

- The header holds the game icon and name, the round, the countdown and the **sound toggle**. Sound is on by default, and muting is remembered per device.
- Stages stay dark in both themes. Use `on-stage` and `on-stage-muted` for text on them.
- The consumer provides `game`, `title`, `round`, `seconds`, `running`, `onSoundChange` and `children` (the game's own UI).
- A third-party game rendered in the FairDrops app gets `stage-custom`. Their own UIs are free to ignore this frame.

```ts
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
```

## TapTarget

The 168px round key for speed games. It fires on `pointerdown`, not click, so there is no delay on phones. It has a 10px press edge and a pop-in counter.

- The consumer provides `count`, `onTap(count)`, `disabled` and `hint`. Space and Enter also tap.
- The server decides the score. Send each tap through `room.act()`, which the SDK rate-limits. The local count is only a preview.
- Put it in the lower third of the screen so thumbs reach it.

```ts
export interface TapTargetProps {
  count?: number;
  label?: string;
  hint?: string;
  disabled?: boolean;
  onTap?: (count: number) => void;
}
```

## Field

A labelled 48px text input with an optional prefix or suffix (a token symbol), hint and error.

- The input text is 16px, so iOS does not zoom.
- Errors say what to do ("Pick at least 1 winner"), never just "Invalid".
- The consumer provides `label` (required and always visible, never a placeholder-only field), optional `hint`, `error`, `prefix`, `suffix`, and any input props.
- Use `inputMode="decimal"` for amounts.

```ts
export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
  suffix?: string;
}
```

## Segmented

One choice among two to four options, as a radiogroup. It replaces dropdowns everywhere in hosting.

- `stacked` turns it into big option cards with hints. This is the audience preset picker, which fills in the giveaway defaults in one tap.
- The consumer provides `label`, `options: [{value, label, hint?, icon?}]`, and `value` with `onChange`, or neither for an uncontrolled picker.

```ts
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
```

## ThemeSwitch

Auto, Light or Dark. Auto follows the device and is the default. The choice sets `data-theme` on `<html>`.

- In the Next.js app, use `next-themes` with `attribute="data-theme"` and `defaultTheme="system"`, so the first paint has no flash.
- Put it in the account menu and in the footer.

```ts
export interface ThemeSwitchProps {
  value?: "system" | "light" | "dark";
  onChange?: (value: "system" | "light" | "dark") => void;
}
```
