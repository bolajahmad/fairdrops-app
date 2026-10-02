import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import type { IconName, PlayerStatus, StatusChipProps } from "./types";

/**
 * Labels are one or two words so the chip stays a pill; `hint` is the full meaning, shown as a
 * tooltip and read by screen readers.
 */
const STATUS: Record<
  PlayerStatus,
  { tone: string; label: string; hint: string; icon?: IconName; dot?: boolean; spin?: boolean }
> = {
  upcoming: {
    tone: "bg-surface-sunken text-ink-muted",
    icon: "clock",
    label: "Starts soon",
    hint: "Not started yet",
  },
  live: { tone: "bg-flare-soft text-flare-strong", dot: true, label: "Live", hint: "Playing now" },
  ending: {
    tone: "bg-flare-soft text-flare-strong",
    dot: true,
    label: "Ending soon",
    hint: "Last chance to play",
  },
  settling: {
    tone: "bg-surface-sunken text-ink-muted",
    icon: "spinner",
    spin: true,
    label: "Counting",
    hint: "Checking the scores before anyone is paid",
  },
  results: {
    tone: "bg-lagoon-soft text-lagoon-strong",
    icon: "check",
    label: "Results in",
    hint: "The winners are final",
  },
  claimable: {
    tone: "bg-lagoon text-on-lagoon motion-pop",
    icon: "gift",
    label: "Prize ready",
    hint: "Your prize is ready to collect",
  },
  claimed: {
    tone: "bg-lagoon-soft text-lagoon-strong",
    icon: "check",
    label: "Collected",
    hint: "Prize collected",
  },
  ended: {
    tone: "bg-surface-sunken text-ink-muted",
    label: "Ended",
    hint: "This giveaway is over",
  },
  cancelled: {
    tone: "bg-danger-soft text-danger-strong",
    icon: "x",
    label: "Cancelled",
    hint: "Cancelled, and the host got the prize back",
  },
  unwon: {
    tone: "bg-surface-sunken text-ink-muted",
    icon: "check",
    label: "No winners",
    hint: "Nobody played or scored enough to win, so the prize went back to the host",
  },
  failed: {
    tone: "bg-danger-soft text-danger-strong",
    icon: "alert",
    label: "Void",
    hint: "The game couldn't run, so nobody was paid and the host gets the prize back",
  },
};

export function StatusChip({ status, label, onStage = false }: StatusChipProps) {
  const item = STATUS[status];
  const text = label ?? item.label;
  // Always one line: a long custom label ends in "…" rather than wrapping out of the pill shape.
  return (
    <span
      title={text === item.hint ? text : `${text}: ${item.hint}`}
      className={cn(
        "inline-flex h-7 max-w-full min-w-0 shrink items-center gap-1 rounded-full px-3 text-[13px] leading-none font-semibold whitespace-nowrap",
        onStage ? "bg-white/10 text-on-stage" : item.tone,
      )}
    >
      {item.dot ? (
        <span className="size-2 shrink-0 rounded-full bg-flare" aria-hidden />
      ) : item.icon ? (
        <Icon name={item.icon} size={14} spin={item.spin} />
      ) : null}
      <span className="min-w-0 truncate">{text}</span>
      <span className="sr-only">. {item.hint}</span>
    </span>
  );
}
