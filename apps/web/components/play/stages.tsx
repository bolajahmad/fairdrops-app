"use client";

import { useEffect, useState } from "react";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/cn";
import { gameHowTo, gameTitle, type GameSlot } from "@/lib/play-director";
import { playBlip } from "@/lib/sound";
import { gameIconName } from "@/components/avatar";
import { Button } from "@/components/button";
import { GameStage } from "@/components/game-stage";
import { Icon } from "@/components/icon";

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function DieFace({
  value,
  rolling,
  small = false,
}: {
  value: number;
  rolling: boolean;
  small?: boolean;
}) {
  const pips = PIPS[value] ?? PIPS[1];
  return (
    <span
      className={cn(
        "grid grid-cols-3 grid-rows-3 rounded-lg bg-on-stage shadow-[0_4px_0_0_var(--lagoon-press)]",
        small ? "size-14 p-2" : "size-[104px] p-3",
        rolling && "motion-shake",
      )}
      aria-label={`Die showing ${value}`}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          className={cn(
            "m-auto rounded-full",
            small ? "size-2" : "size-3",
            pips?.includes(index) ? "bg-stage-dice" : "bg-transparent",
          )}
        />
      ))}
    </span>
  );
}

export function DiceStage({
  round,
  seconds,
  faces,
  rolling,
  best,
  place,
  players,
  rollsLeft,
  hasNext,
  onRoll,
  onSlotComplete,
}: {
  round: string;
  seconds: number;
  faces: readonly number[];
  rolling: boolean;
  best: string;
  place: string;
  players: string;
  rollsLeft: number;
  hasNext: boolean;
  onRoll: () => void;
  onSlotComplete: () => void;
}) {
  return (
    <GameStage
      game="dice"
      round={round}
      seconds={seconds}
      running
      className="min-h-dvh rounded-none"
    >
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6">
        <div className="flex flex-1 items-center justify-center gap-4">
          {faces.map((face, index) => (
            <DieFace key={index} value={face} rolling={rolling} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 text-on-stage">
          <Stat label="Your total" value={best} />
          <Stat label="Your place" value={place} />
          <Stat label="Players" value={players} />
        </div>
        <div className="flex flex-col gap-2">
          {rollsLeft > 0 ? (
            <Button size="lg" block loading={rolling} onClick={onRoll}>
              {rolling ? copy.rolling : copy.roll}
            </Button>
          ) : hasNext ? (
            <Button size="lg" block variant="secondary" iconAfter="arrow" onClick={onSlotComplete}>
              {copy.doneNext}
            </Button>
          ) : (
            <Button size="lg" block variant="secondary" disabled>
              {copy.scoresLock}
            </Button>
          )}
          <span className="caption text-center text-on-stage/80">{copy.fairnessNote}</span>
        </div>
      </div>
    </GameStage>
  );
}

export function QuizStage({
  round,
  seconds,
  prompt,
  choices,
  picked,
  reveal,
  feedback,
  onPick,
}: {
  round: string;
  seconds: number;
  prompt: string;
  choices: readonly string[];
  picked: number | null;
  reveal: number | null;
  feedback: string;
  onPick: (choice: number) => void;
}) {
  return (
    <GameStage
      game="quiz"
      round={round}
      seconds={seconds}
      running
      className="min-h-dvh rounded-none"
    >
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-4">
        <h2 className="title-l m-0 text-balance text-on-stage">{prompt}</h2>
        <div className="flex flex-col gap-3">
          {choices.map((choice, index) => {
            const right = reveal === index;
            const selected = picked === index;
            return (
              <button
                key={`${choice}-${index}`}
                type="button"
                disabled={picked !== null}
                onClick={() => onPick(index)}
                className={cn(
                  "flex min-h-12 w-full flex-wrap items-center gap-3 rounded-md px-4 py-3 text-left break-words whitespace-normal shadow-[0_4px_0_0_var(--ink-muted)] active:translate-y-1 active:shadow-none",
                  right
                    ? "bg-lagoon text-on-lagoon"
                    : selected
                      ? "bg-flare-soft text-ink"
                      : "bg-on-stage text-ink",
                )}
              >
                <span className="inline-grid size-7 place-items-center rounded-full bg-surface-sunken text-sm font-bold text-ink">
                  {"ABCD"[index] ?? index + 1}
                </span>
                <span className="min-w-0 flex-1">{choice}</span>
                {right ? <Icon name="check" /> : null}
              </button>
            );
          })}
        </div>
        <span className="caption text-on-stage/80">{feedback}</span>
      </div>
    </GameStage>
  );
}

export function NextStage({
  slot,
  index,
  total,
  onDone,
}: {
  slot: GameSlot;
  index: number;
  total: number;
  onDone: () => void;
}) {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (n === 0) {
      const timer = setTimeout(onDone, 400);
      return () => clearTimeout(timer);
    }
    playBlip(520);
    const timer = setTimeout(() => setN(n - 1), 800);
    return () => clearTimeout(timer);
  }, [n, onDone]);

  return (
    <div
      className={`on-stage flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center stage-${slot.id}`}
    >
      <span className="overline text-on-stage/70">
        Game {index} of {total}
      </span>
      <Icon name={gameIconName(slot.id)} size={56} />
      <h1 className="display-xl m-0">{gameTitle(slot.id)}</h1>
      <p className="body-l m-0 max-w-sm text-on-stage/80">{gameHowTo(slot.id)}</p>
      <span
        key={n}
        className="motion-pop grid size-[120px] place-items-center rounded-full bg-flare text-4xl font-extrabold text-on-flare"
      >
        {n === 0 ? "Go" : n}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="caption text-on-stage/70">{label}</span>
      <span className="font-mono text-2xl font-bold">{value}</span>
    </span>
  );
}
