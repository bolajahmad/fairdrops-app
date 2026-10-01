import { cn } from "@/lib/cn";
import { Avatar } from "./avatar";
import { PrizeAmount } from "./prize-amount";
import type { LeaderboardRowProps } from "./types";

export function LeaderboardRow({
  rank,
  name,
  score,
  prize,
  symbol,
  you = false,
  hue = 0,
  delay = 0,
  onStage = false,
}: LeaderboardRowProps) {
  return (
    <li
      className={cn(
        "motion-rise grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 border-b border-line py-3",
        you && "rounded-md bg-lagoon-soft px-2",
        onStage && "border-white/15",
      )}
      style={delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
    >
      <span className={cn("w-6 font-mono font-bold", rank <= 3 ? "text-lagoon" : "text-ink-muted")}>
        {rank}
      </span>
      <Avatar name={name} hue={hue} />
      <span className="flex min-w-0 items-center gap-2 font-semibold">
        <span className="truncate">{name}</span>
        {you ? (
          <span className="caption shrink-0 rounded-full bg-lagoon px-2 text-on-lagoon">You</span>
        ) : null}
      </span>
      <span className="font-mono tabular-nums">{score}</span>
      {prize ? (
        <PrizeAmount amount={prize} symbol={symbol} size="s" />
      ) : (
        <span className="text-ink-faint">—</span>
      )}
    </li>
  );
}
