import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import type { IconName, PlayerStatus, StatusChipProps } from "./types";

const STATUS: Record<
  PlayerStatus,
  { tone: string; label: string; icon?: IconName; dot?: boolean; spin?: boolean }
> = {
  upcoming: { tone: "bg-surface-sunken text-ink-muted", icon: "clock", label: "Starts soon" },
  live: { tone: "bg-flare-soft text-flare-strong", dot: true, label: "Live" },
  ending: { tone: "bg-flare-soft text-flare-strong", dot: true, label: "Ending soon" },
  settling: {
    tone: "bg-surface-sunken text-ink-muted",
    icon: "spinner",
    spin: true,
    label: "Counting results",
  },
  results: { tone: "bg-lagoon-soft text-lagoon-strong", icon: "check", label: "Results in" },
  claimable: { tone: "bg-lagoon text-on-lagoon motion-pop", icon: "gift", label: "Prize ready" },
  claimed: { tone: "bg-lagoon-soft text-lagoon-strong", icon: "check", label: "Collected" },
  ended: { tone: "bg-surface-sunken text-ink-muted", label: "Ended" },
  cancelled: {
    tone: "bg-danger-soft text-danger-strong",
    icon: "x",
    label: "Cancelled · refunded",
  },
  failed: { tone: "bg-danger-soft text-danger-strong", icon: "alert", label: "Game void" },
};

export function StatusChip({ status, label, onStage = false }: StatusChipProps) {
  const item = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex h-auto min-h-7 max-w-full flex-wrap items-center gap-1 rounded-full px-3 py-1 text-[13px] leading-[18px] font-semibold break-words whitespace-normal",
        onStage ? "bg-white/10 text-on-stage" : item.tone,
      )}
    >
      {item.dot ? (
        <span className="size-2 shrink-0 rounded-full bg-flare" aria-hidden />
      ) : item.icon ? (
        <Icon name={item.icon} size={14} spin={item.spin} />
      ) : null}
      {label ?? item.label}
    </span>
  );
}
