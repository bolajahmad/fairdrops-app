import { cn } from "@/lib/cn";
import { formatCountdown } from "@/lib/format";
import type { CountdownProps } from "./types";

const SIZES = {
  s: "text-[13px]",
  m: "text-xl",
  l: "text-5xl leading-none",
} as const;

/**
 * Displays seconds the parent computed from the server clock. It does not read the device clock.
 * Green counts down to a start; red marks the last seconds before something closes.
 */
export function Countdown({
  seconds,
  running = true,
  label,
  size = "m",
  urgentAt = 10,
  doneLabel,
  onStage = false,
  tone = "cutoff",
}: CountdownProps) {
  const left = Math.max(0, Math.floor(seconds));
  const urgent = running && left <= urgentAt && left > 0;
  const done = left === 0;
  return (
    <span
      role="timer"
      aria-live={urgent ? "assertive" : "off"}
      className={cn(
        "inline-flex max-w-full flex-wrap items-baseline gap-2 font-mono font-bold tabular-nums",
        SIZES[size],
        tone === "start"
          ? onStage
            ? "text-stage-go"
            : "text-lagoon"
          : onStage
            ? "text-on-stage"
            : "text-ink",
        urgent && "motion-pop",
        urgent && tone === "cutoff" && (onStage ? "text-stage-alert" : "text-danger"),
        done && "text-ink-muted",
      )}
    >
      {label ? (
        <span className="caption font-body font-medium text-inherit opacity-70">{label}</span>
      ) : null}
      <span key={urgent ? left : "steady"}>
        {done && doneLabel ? doneLabel : formatCountdown(left)}
      </span>
    </span>
  );
}
