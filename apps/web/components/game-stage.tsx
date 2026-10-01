"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { loadSoundPreference, setSoundEnabled, subscribeSound } from "@/lib/sound";
import { Countdown } from "./countdown";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import { gameIconName } from "./avatar";
import type { GameKind, GameStageProps } from "./types";

const NAMES: Record<GameKind, string> = {
  dice: "Dice",
  quiz: "Quiz",
  tap: "Tap Rush",
  custom: "Game",
};

export function GameStage({
  game,
  title,
  round,
  seconds,
  running = true,
  sound,
  onSoundChange,
  className,
  children,
}: GameStageProps) {
  const stored = useSyncExternalStore(subscribeSound, loadSoundPreference, () => true);
  const on = sound ?? stored;
  const label = title ?? NAMES[game];

  function toggle() {
    const next = !on;
    setSoundEnabled(next);
    onSoundChange?.(next);
  }

  return (
    <section
      aria-label={`${label} game`}
      className={cn("on-stage flex flex-col gap-4 p-4 stage-" + game, className)}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span className="inline-grid size-10 place-items-center rounded-md bg-white/10">
          <Icon name={gameIconName(game)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-xl font-bold">{label}</div>
          {round ? <div className="caption text-on-stage/70">{round}</div> : null}
        </div>
        {seconds !== undefined ? (
          <Countdown seconds={seconds} running={running} size="m" onStage />
        ) : null}
        <IconButton
          tone="stage"
          icon={on ? "volume" : "mute"}
          label={on ? "Mute game sounds" : "Turn game sounds on"}
          pressed={!on}
          onClick={toggle}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
