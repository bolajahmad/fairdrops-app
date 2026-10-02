"use client";

import { Icon } from "./icon";
import { TokenAvatar } from "./token-avatar";
import { cn } from "@/lib/cn";
import { formatTokenAmount } from "@/lib/format";
import { formatReference, type TokenTotal } from "@/lib/prices";
import { chainName } from "@/lib/tokens";

/**
 * A money total in approximate USDT, with a toggle for the per-token breakdown. Falls back to a
 * token count when nothing can be priced. Pair it with `ValueBreakdown`, which can sit anywhere.
 */
export function ValueSummary({
  totals,
  open,
  onToggle,
  panelId,
  tone = "default",
}: {
  totals: TokenTotal[];
  open: boolean;
  onToggle: () => void;
  panelId: string;
  /** `onLagoon` for a lagoon-soft card. */
  tone?: "default" | "onLagoon";
}) {
  const priced = totals.filter((total) => total.value !== null);
  const unpriced = totals.length - priced.length;
  const value = priced.reduce((sum, total) => sum + (total.value ?? 0), 0);
  return (
    <>
      <span
        className={cn(
          "font-display text-2xl font-extrabold tabular-nums",
          tone === "onLagoon" ? "text-lagoon-strong" : "text-lagoon",
        )}
      >
        {priced.length > 0
          ? formatReference(value)
          : `${totals.length} ${totals.length === 1 ? "token" : "tokens"}`}
      </span>
      {totals.length > 0 ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            "-ml-2 inline-flex min-h-9 cursor-pointer items-center gap-1 self-start rounded-full px-2 text-sm font-semibold transition-colors",
            tone === "onLagoon"
              ? "text-lagoon-strong hover:bg-lagoon/10"
              : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
          )}
        >
          {unpriced > 0 && priced.length > 0 ? `+ ${unpriced} without a price · ` : ""}
          Breakdown
          <Icon
            name="chevron"
            size={16}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </button>
      ) : null}
    </>
  );
}

/** The per-token list behind a `ValueSummary`, sliding open in place. */
export function ValueBreakdown({
  totals,
  open,
  id,
  className,
}: {
  totals: TokenTotal[];
  open: boolean;
  id: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="overflow-hidden">
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface-raised p-3">
          <span className="overline px-2 pt-1 text-ink-muted">By token</span>
          <ul className="m-0 flex list-none flex-col p-0">
            {totals.map((total) => (
              <li key={total.key} className="flex items-center gap-3 rounded-md px-2 py-2.5">
                <TokenAvatar symbol={total.symbol} chainId={total.chainId} size={32} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold tabular-nums">
                    {formatTokenAmount(total.amount.toString(), total.decimals)} {total.symbol}
                  </span>
                  <span className="caption truncate text-ink-muted">
                    on {chainName(total.chainId)}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm font-semibold text-ink-muted tabular-nums">
                  {total.value !== null ? formatReference(total.value) : "No price"}
                </span>
              </li>
            ))}
          </ul>
          <p className="caption m-0 px-2 pb-1 text-ink-muted">
            Approximate, at today&apos;s prices. Prizes are always paid in their own token.
            Unverified tokens are never priced.
          </p>
        </section>
      </div>
    </div>
  );
}
