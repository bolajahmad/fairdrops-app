import { cn } from "@/lib/cn";
import type { GameKind } from "./types";

export function Avatar({
  name,
  hue = 0,
  size = 32,
}: {
  name: string;
  hue?: number;
  size?: number;
}) {
  const initials = name
    .replace(/^@/, "")
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const tint = [
    "bg-lagoon-soft text-lagoon-strong",
    "bg-surface-sunken text-ink",
    "bg-lagoon text-on-lagoon",
    "bg-line text-ink",
  ][Math.abs(hue) % 4];
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-full text-xs font-bold", tint)}
      style={{ width: size, height: size }}
    >
      {initials || "?"}
    </span>
  );
}

export function gameIconName(kind: GameKind): "dice" | "quiz" | "tap" | "puzzle" {
  switch (kind) {
    case "dice":
      return "dice";
    case "quiz":
      return "quiz";
    case "tap":
      return "tap";
    case "custom":
      return "puzzle";
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}
