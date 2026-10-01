import { cn } from "@/lib/cn";
import type { PrizeAmountProps } from "./types";

const SIZES = {
  s: "text-sm",
  m: "text-xl",
  l: "text-[28px] leading-8",
  xl: "text-[40px] leading-[44px]",
} as const;

export function PrizeAmount({
  amount,
  symbol = "USDC",
  size = "m",
  note,
  muted = false,
}: PrizeAmountProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-1 font-display font-extrabold tracking-[-0.02em] tabular-nums",
        SIZES[size],
        muted ? "text-ink-muted" : "text-lagoon",
      )}
    >
      <span className="break-words whitespace-normal">{amount}</span>
      <span className="text-[0.62em]">{symbol}</span>
      {note ? (
        <span className="caption w-full font-body font-medium text-ink-muted">{note}</span>
      ) : null}
    </span>
  );
}
