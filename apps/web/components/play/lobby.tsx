"use client";

import type { GiveawayView } from "@fairdrops/shared";
import { rewardPlaces } from "@fairdrops/shared";
import { useEffect, useState } from "react";
import { AppBar } from "@/components/app-bar";
import { gameIconName } from "@/components/avatar";
import { Countdown } from "@/components/countdown";
import { Icon } from "@/components/icon";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/lib/cn";
import { browserFairDrops } from "@/lib/fairdrops";
import { formatTokenAmount, tokenDecimals, tokenSymbol } from "@/lib/format";
import { gameHowTo, gameTitle, type GameSlot } from "@/lib/play-director";
import { playBlip } from "@/lib/sound";
import { DieFace } from "./stages";

/** How often the lobby refreshes the player count while it waits. */
const PLAYERS_EVERY_MS = 5_000;
const TIP_EVERY_MS = 6_000;

const FAIRNESS_TIPS = [
  "Every roll and question was fixed by a seed locked on-chain before the start. Nobody can change it now.",
  "After the game, you can check the result yourself, right in your browser.",
  "Prizes are locked in a public contract. Nobody, not even the host, can move them except to pay the winners.",
  "Turn your sound on for the countdown and the dice.",
];

/**
 * Waiting room before the first game. The wait is the quietest moment of a giveaway, so it
 * gives people something to look at and do: who else is here (live), what's up for grabs, a
 * practice roll that doesn't count, tips on how to win, and a way to bring a friend.
 */
export function LobbyStage({
  title,
  seconds,
  games,
  players: initialPlayers,
  backHref,
  sessionId,
  giveaway,
}: {
  title: string;
  seconds: number;
  games: readonly GameSlot[];
  players: number;
  backHref?: string;
  /** Keeps the player count live. */
  sessionId?: string;
  /** Shows the prize and lets people share the giveaway. */
  giveaway?: { chainId: number; giveawayId: string };
}) {
  const [players, setPlayers] = useState(initialPlayers);
  const [grew, setGrew] = useState(0);
  const [prize, setPrize] = useState<GiveawayView | null>(null);
  const [tip, setTip] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    const timer = setInterval(() => {
      browserFairDrops()
        .sessions.get(sessionId)
        .then((session) => {
          if (!live) return;
          setPlayers((current) => {
            if (session.playerCount > current) setGrew((n) => n + 1);
            return session.playerCount;
          });
        })
        .catch(() => {});
    }, PLAYERS_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sessionId]);

  // By value: the parent passes a new object on every render.
  const chainId = giveaway?.chainId;
  const giveawayId = giveaway?.giveawayId;
  useEffect(() => {
    if (chainId === undefined || !giveawayId) return;
    let live = true;
    browserFairDrops()
      .giveaways.get(chainId, giveawayId as `0x${string}`)
      .then((view) => live && setPrize(view))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [chainId, giveawayId]);

  const tips = [
    ...games.map((game) => `${gameTitle(game.id)}: ${gameHowTo(game.id)}`),
    ...FAIRNESS_TIPS,
  ];
  useEffect(() => {
    const timer = setInterval(() => setTip((n) => n + 1), TIP_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  const winners = prize ? (prize.rewards ? rewardPlaces(prize.rewards) : prize.maxWinners) : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <AppBar title={title} backHref={backHref} />
      <div className="flex flex-1 flex-col gap-5 px-4 pb-8">
        <section className="flex flex-col gap-3 rounded-xl bg-lagoon-soft p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="overline text-lagoon-strong">{"You're in"}</span>
            <span
              key={grew}
              className={cn(
                "inline-flex items-center gap-2 text-sm font-semibold text-lagoon-strong",
                grew > 0 && "motion-pop",
              )}
              aria-live="polite"
            >
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-lagoon opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-2.5 rounded-full bg-lagoon" />
              </span>
              {players} {players === 1 ? "player" : "players"} here
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Countdown seconds={seconds} running size="l" urgentAt={5} tone="start" />
            <span className="caption text-lagoon-strong">
              until {games[0] ? gameTitle(games[0].id) : "the first game"} starts. It starts on its
              own.
            </span>
          </div>
        </section>

        <p
          key={tip}
          className="motion-rise caption m-0 flex gap-2 rounded-md bg-surface-sunken p-3 text-ink-muted"
        >
          <Icon name="sparkles" size={16} className="mt-0.5 text-lagoon" />
          <span>{tips[tip % tips.length]}</span>
        </p>

        {prize ? (
          <section className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised p-4">
            <span className="flex min-w-0 flex-col">
              <span className="caption text-ink-muted">Up for grabs</span>
              <span className="truncate font-display text-2xl font-extrabold text-lagoon tabular-nums">
                {formatTokenAmount(prize.prize, tokenDecimals(prize))} {tokenSymbol(prize)}
              </span>
              {winners ? (
                <span className="caption text-ink-muted">
                  Top {winners} {winners === 1 ? "player wins" : "players win"}
                </span>
              ) : null}
            </span>
            {giveaway ? (
              <span className="flex flex-col items-center gap-1">
                <ShareButton
                  path={`/g/${giveaway.chainId}/${giveaway.giveawayId}`}
                  title={prize.metadata?.title ?? "FairDrops giveaway"}
                />
                <span className="caption text-ink-muted">Bring a friend</span>
              </span>
            ) : null}
          </section>
        ) : null}

        <WarmUp />

        <section className="flex flex-col gap-3">
          <span className="overline text-ink-muted">
            {games.length > 1 ? "Coming up" : "The game"}
          </span>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {games.map((game, index) => (
              <li key={`${game.id}-${index}`} className="flex items-center gap-3">
                <span
                  className={`inline-grid size-10 shrink-0 place-items-center rounded-md text-on-stage stage-${game.id}`}
                >
                  <Icon name={gameIconName(game.id)} size={20} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="body-strong">
                    {gameTitle(game.id)}
                    {index === 0 ? (
                      <span className="caption ml-2 text-lagoon">First up</span>
                    ) : null}
                  </span>
                  <span className="caption text-ink-muted">{gameHowTo(game.id)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

/** A practice roll while waiting: random on this device, and clearly not part of the game. */
function WarmUp() {
  const [faces, setFaces] = useState([3, 4]);
  const [rolling, setRolling] = useState(false);
  const [best, setBest] = useState<number | null>(null);

  function roll() {
    if (rolling) return;
    setRolling(true);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      const next = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
      setFaces(next);
      playBlip(320);
      if (ticks >= 8) {
        clearInterval(timer);
        setRolling(false);
        playBlip(880);
        const total = next[0]! + next[1]!;
        setBest((current) => (current === null ? total : Math.max(current, total)));
      }
    }, 70);
  }

  return (
    <section className="on-stage stage-dice flex items-center gap-4 rounded-lg p-4">
      <button
        type="button"
        onClick={roll}
        aria-label="Practice roll"
        className="flex shrink-0 cursor-pointer gap-2"
      >
        {faces.map((face, index) => (
          <DieFace key={index} value={face} rolling={rolling} small />
        ))}
      </button>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold">Warm up</span>
        <span className="caption text-on-stage/80">
          {best === null
            ? "Tap the dice for a practice roll. It doesn't count."
            : `Best practice roll: ${best}. Save that luck for the real thing.`}
        </span>
      </span>
    </section>
  );
}
