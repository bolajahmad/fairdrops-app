import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import type { FairBadgeProps, IconName } from "./types";

const STATES: Record<
  NonNullable<FairBadgeProps["state"]>,
  { tone: string; icon: IconName; label: string; spin?: boolean }
> = {
  pending: { tone: "text-ink-muted", icon: "shield", label: "Checked after the game" },
  checking: { tone: "text-ink-muted", icon: "spinner", spin: true, label: "Checking results…" },
  verified: { tone: "text-lagoon-strong", icon: "shield", label: "Verified fair" },
  failed: { tone: "text-danger", icon: "alert", label: "Results don't match" },
};

/** A link when given `href`, a button when given `onClick`, otherwise a static badge. */
export function FairBadge({ state = "verified", label, detail, onClick, href }: FairBadgeProps) {
  const item = STATES[state];
  const text = label ?? item.label;
  const className = cn(
    "inline-flex w-fit max-w-full items-center gap-2 rounded-full border-[1.5px] border-current px-3 py-1.5 text-left text-sm font-semibold no-underline",
    (href || onClick) && "hover:bg-surface-sunken",
    item.tone,
  );
  const body = (
    <>
      <Icon name={item.icon} size={16} spin={item.spin} />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {text}
        {detail ? <span className="font-medium text-ink-muted"> · {detail}</span> : null}
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className} aria-label={`${text}. Show how this was checked`}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <span className={className}>{body}</span>;
}
