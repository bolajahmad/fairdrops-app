import { cn } from "@/lib/cn";
import type { LogoProps } from "./types";

function Mark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
      <path
        d="M9 27a15 15 0 0 0 30 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M24 3.5s-8.5 10-8.5 16.2a8.5 8.5 0 0 0 17 0C32.5 13.5 24 3.5 24 3.5z"
        fill="var(--lagoon)"
      />
      <circle cx="20.6" cy="19.4" r="2.1" fill="var(--on-lagoon)" fillOpacity="0.9" />
    </svg>
  );
}

export function Logo({ variant = "full", size = 32 }: LogoProps) {
  const markSize = variant === "full" ? Math.max(20, size) : Math.max(16, size);
  const word = (
    <span
      className="font-display text-[1.15em] leading-none font-extrabold tracking-[-0.03em] text-ink"
      style={{ fontSize: markSize * 0.72 }}
    >
      FairDrops
    </span>
  );

  if (variant === "app") {
    return (
      <span
        className="inline-grid place-items-center rounded-[22%] bg-surface-raised text-ink"
        style={{ width: markSize, height: markSize }}
      >
        <Mark size={markSize * 0.72} />
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", variant === "mark" && "gap-0")}>
      <Mark size={markSize} />
      {variant === "full" ? word : null}
    </span>
  );
}
