import { copy } from "@/lib/copy";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { FairBadge } from "./fair-badge";
import { PrizeAmount } from "./prize-amount";
import type { ClaimCardProps } from "./types";

export function ClaimCard({
  state,
  rank,
  amount,
  symbol,
  note,
  deadline,
  winners = 3,
  onCollect,
  onShare,
  verifyHref,
}: ClaimCardProps) {
  const title = {
    waiting: "Results are being counted",
    ready: `Your prize for #${rank ?? ""}`,
    collecting: "Sending your prize…",
    collected: "Prize collected",
    expired: "Collection window closed",
    none: "No prize this time",
  }[state];
  const body = {
    waiting: "Prizes unlock once every score is checked. This usually takes a couple of minutes.",
    ready: `Collect before ${deadline ?? "the deadline"}. Unclaimed prizes go back to the host.`,
    collecting: "Keep this page open. It's on its way to your wallet.",
    collected: "It's in your wallet. You can check the payment any time.",
    expired: `Prizes had to be collected by ${deadline ?? "the deadline"}. Unclaimed funds went back to the host.`,
    none: `You finished #${rank ?? ""}. Winners were the top ${winners}. There are more drops coming.`,
  }[state];
  const showAmount = state === "ready" || state === "collecting" || state === "collected";

  return (
    <section
      aria-live="polite"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-line bg-surface-raised p-4 shadow-[var(--lift)]",
        state === "ready" && "border-lagoon shadow-[0_0_0_3px_var(--lagoon-soft)]",
        (state === "expired" || state === "none") &&
          "border-transparent bg-surface-sunken shadow-none",
      )}
    >
      {/* The fairness badge is a status of the result, so it sits with the title, not the actions. */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="m-0 font-display text-xl font-bold">{title}</p>
        {state === "waiting" ? (
          <FairBadge state="checking" />
        ) : state === "ready" || state === "collecting" || state === "collected" ? (
          <FairBadge state="verified" href={verifyHref} />
        ) : null}
      </header>
      {showAmount && amount ? (
        <PrizeAmount amount={amount} symbol={symbol} size="xl" note={note} />
      ) : null}
      <p className="m-0 text-ink-muted">{body}</p>
      {state === "ready" ? (
        <Button size="lg" block icon="gift" onClick={onCollect}>
          {copy.collect}
        </Button>
      ) : null}
      {state === "collecting" ? (
        <Button size="lg" block loading>
          {copy.collecting}
        </Button>
      ) : null}
      {state === "collected" ? (
        <Button variant="secondary" icon="share" className="self-start" onClick={onShare}>
          {copy.shareWin}
        </Button>
      ) : null}
    </section>
  );
}
