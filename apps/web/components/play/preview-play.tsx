"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorNote } from "@/components/error-note";
import { copy } from "@/lib/copy";
import {
  initialBeat,
  parseLineup,
  reducePlay,
  UnsupportedGameError,
  type GameSlot,
  type PlayBeat,
} from "@/lib/play-director";
import { playBlip } from "@/lib/sound";
import { DiceStage, LobbyStage, NextStage, QuizStage } from "./stages";

const QUIZ = [
  {
    prompt: "Which planet has the most known moons?",
    choices: ["Jupiter", "Saturn", "Uranus", "Neptune"],
    answer: 1,
  },
  {
    prompt: "Which ocean is the largest?",
    choices: ["Atlantic", "Indian", "Pacific", "Arctic"],
    answer: 2,
  },
];

export function PreviewPlay() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("lineup") ?? "dice,quiz";
  let lineup: GameSlot[] | null = null;
  let lineupError: string | null = null;
  try {
    lineup = parseLineup(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    );
  } catch (error) {
    lineupError =
      error instanceof UnsupportedGameError ? error.message : "That lineup is not available.";
  }

  const [beat, setBeat] = useState<PlayBeat>(initialBeat());
  const [lobbySeconds, setLobbySeconds] = useState(4);
  const [faces, setFaces] = useState<number[]>([1, 1]);
  const [rolls, setRolls] = useState(0);
  const [best, setBest] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [question, setQuestion] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    if (beat.type !== "lobby" || !lineup) return;
    const slots = lineup;
    const timer = setTimeout(
      () => {
        if (lobbySeconds <= 0) {
          setBeat((current) => reducePlay(current, slots, { type: "status", status: "RUNNING" }));
        } else {
          setLobbySeconds((value) => value - 1);
        }
      },
      lobbySeconds <= 0 ? 0 : 1000,
    );
    return () => clearTimeout(timer);
  }, [beat.type, lobbySeconds, lineup]);

  useEffect(() => {
    if (beat.type === "settling" || beat.type === "results") router.push("/play/preview/results");
  }, [beat.type, router]);

  const onCountdownDone = useCallback(() => {
    if (!lineup) return;
    setRolls(0);
    setBest(0);
    setQuestion(0);
    setPicked(null);
    setBeat((current) => reducePlay(current, lineup, { type: "countdown-done" }));
  }, [lineup]);

  const onSlotComplete = useCallback(() => {
    if (!lineup) return;
    setBeat((current) => reducePlay(current, lineup, { type: "slot-finished" }));
  }, [lineup]);

  if (lineupError || !lineup) {
    return (
      <div className="mx-auto max-w-[480px] p-6">
        <ErrorNote>{lineupError}</ErrorNote>
      </div>
    );
  }

  const slot = beat.type === "play" || beat.type === "next" ? lineup[beat.slot] : undefined;

  return (
    <div
      data-play-beat={beat.type}
      data-play-slot={beat.type === "play" || beat.type === "next" ? beat.slot : undefined}
    >
      <p className="caption mx-auto max-w-[480px] px-4 pt-4 text-ink-muted">{copy.previewNote}</p>
      {beat.type === "lobby" ? (
        <LobbyStage title="Preview" seconds={lobbySeconds} games={lineup} players={12} />
      ) : null}
      {beat.type === "next" && slot ? (
        <NextStage
          slot={slot}
          index={beat.slot + 1}
          total={lineup.length}
          onDone={onCountdownDone}
        />
      ) : null}
      {beat.type === "play" && slot?.id === "dice" ? (
        <DiceStage
          round={`Game ${beat.slot + 1} of ${lineup.length} · Roll ${Math.min(rolls + 1, 3)} of 3`}
          seconds={45}
          faces={faces}
          rolling={rolling}
          best={best ? String(best) : "–"}
          place="#4"
          players="12"
          rollsLeft={Math.max(0, 3 - rolls)}
          hasNext={beat.slot + 1 < lineup.length}
          onRoll={() => {
            if (rolling || rolls >= 3) return;
            setRolling(true);
            let ticks = 0;
            const timer = setInterval(() => {
              setFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
              playBlip(300 + ticks * 40);
              ticks += 1;
              if (ticks > 7) {
                clearInterval(timer);
                const next: [number, number] = [
                  1 + Math.floor(Math.random() * 6),
                  1 + Math.floor(Math.random() * 6),
                ];
                setFaces(next);
                setBest((current) => Math.max(current, next[0] + next[1]));
                setRolls((current) => current + 1);
                setRolling(false);
                playBlip(880);
              }
            }, 70);
          }}
          onSlotComplete={onSlotComplete}
        />
      ) : null}
      {beat.type === "play" && slot?.id === "quiz" ? (
        <QuizStage
          round={`Game ${beat.slot + 1} of ${lineup.length} · Question ${question + 1} of ${QUIZ.length}`}
          seconds={8}
          prompt={QUIZ[question]?.prompt ?? ""}
          choices={QUIZ[question]?.choices ?? []}
          picked={picked}
          reveal={picked === null ? null : (QUIZ[question]?.answer ?? null)}
          feedback={
            picked === null
              ? copy.faster
              : picked === QUIZ[question]?.answer
                ? copy.right
                : copy.wrong
          }
          onPick={(choice) => {
            if (picked !== null) return;
            setPicked(choice);
            playBlip(choice === QUIZ[question]?.answer ? 880 : 220);
            window.setTimeout(() => {
              if (question + 1 >= QUIZ.length) onSlotComplete();
              else {
                setQuestion((current) => current + 1);
                setPicked(null);
              }
            }, 700);
          }}
        />
      ) : null}
    </div>
  );
}
