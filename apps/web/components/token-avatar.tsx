import { cn } from "@/lib/cn";

/** A token's mark: its symbol's first letters on a colour picked from the symbol, plus a network dot. */
export function TokenAvatar({
  symbol,
  chainId,
  size = 36,
}: {
  symbol: string;
  chainId: number;
  size?: number;
}) {
  const tones = [
    "bg-lagoon text-on-lagoon",
    "bg-stage-quiz text-on-stage",
    "bg-stage-tap text-on-stage",
    "bg-stage-dice text-on-stage",
    "bg-ink text-surface",
  ];
  const hash = [...symbol].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const chainTone = ["bg-lagoon", "bg-flare", "bg-stage-quiz", "bg-ink-muted"][chainId % 4];
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        className={cn(
          "grid size-full place-items-center rounded-full font-display font-extrabold",
          tones[hash % tones.length],
        )}
        style={{ fontSize: Math.round(size * 0.34) }}
      >
        {symbol
          .replace(/[^a-z0-9]/gi, "")
          .slice(0, 3)
          .toUpperCase() || "?"}
      </span>
      <span
        className={cn(
          "absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-surface-raised",
          chainTone,
        )}
        style={{ width: size * 0.36, height: size * 0.36 }}
      />
    </span>
  );
}
