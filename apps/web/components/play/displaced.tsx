"use client";

import { Button } from "@/components/button";
import { Icon } from "@/components/icon";

/**
 * Shown on a device after the same player opened the game somewhere else. A player plays on
 * one device at a time; this one can take the game back.
 */
export function PlayingElsewhere({ onPlayHere }: { onPlayHere: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="playing-elsewhere"
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/60 p-4 backdrop-blur-sm sm:items-center"
    >
      <div className="flex w-full max-w-[420px] flex-col gap-4 rounded-xl bg-surface-raised p-6 shadow-[var(--lift)]">
        <span className="grid size-11 place-items-center rounded-full bg-lagoon-soft text-lagoon-strong">
          <Icon name="share" />
        </span>
        <h2 id="playing-elsewhere" className="title-m m-0">
          You&apos;re playing on another device
        </h2>
        <p className="m-0 text-ink-muted">
          You opened this game somewhere else, so it moved there. You can play on one device at a
          time.
        </p>
        <Button size="lg" block onClick={onPlayHere}>
          Play here instead
        </Button>
      </div>
    </div>
  );
}
