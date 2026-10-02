import type { TokenTrust } from "@fairdrops/shared";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

const LOOK: Record<
  TokenTrust,
  { label: string; tone: string; icon: "shield" | "check" | "alert" }
> = {
  verified: { label: "Verified", tone: "bg-lagoon-soft text-lagoon-strong", icon: "shield" },
  listed: { label: "Listed", tone: "bg-surface-sunken text-ink-muted", icon: "check" },
  unverified: { label: "Unverified", tone: "bg-flare-soft text-flare-strong", icon: "alert" },
};

/** How far FairDrops vouches for a token. Shown wherever a token is picked or a prize is shown. */
export function TrustBadge({ trust, className }: { trust: TokenTrust; className?: string }) {
  const look = LOOK[trust];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        look.tone,
        className,
      )}
    >
      <Icon name={look.icon} size={12} />
      {look.label}
    </span>
  );
}
