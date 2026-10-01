"use client";

import type {
  DicePlayerView,
  DicePublicView,
  QuizPlayerView,
  QuizPublicView,
} from "@fairdrops/game-kit";
import type { SessionView } from "@fairdrops/sdk";
import { LiveConnection, type Room } from "@fairdrops/sdk/live";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { ErrorNote } from "@/components/error-note";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { copy } from "@/lib/copy";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import {
  initialBeat,
  lineupFromSession,
  reducePlay,
  type GameSlot,
  type PlayBeat,
} from "@/lib/play-director";
import { playBlip } from "@/lib/sound";
import { DiceStage, LobbyStage, NextStage, QuizStage } from "./stages";

type Views = {
  publicView: DicePublicView | QuizPublicView | null;
  playerView: DicePlayerView | QuizPlayerView | null;
};

export function LivePlay({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionView | null>(null);
  const [lineup, setLineup] = useState<GameSlot[] | null>(null);
  const [beat, setBeat] = useState<PlayBeat>(initialBeat());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ended, setEnded] = useState<"CANCELLED" | "FAILED" | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  const [views, setViews] = useState<Views>({ publicView: null, playerView: null });
  const [rolling, setRolling] = useState(false);
  const [shownFaces, setShownFaces] = useState<number[]>([1, 1]);
  const [room, setRoom] = useState<Room<
    DicePublicView | QuizPublicView,
    DicePlayerView | QuizPlayerView
  > | null>(null);

  useEffect(() => {
    let cancel = false;
    let live: LiveConnection | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      try {
        const fd = browserFairDrops();
        const loaded = await fd.sessions.get(sessionId);
        if (cancel) return;
        if (loaded.status === "CANCELLED" || loaded.status === "FAILED") {
          setSession(loaded);
          setEnded(loaded.status);
          return;
        }
        const slots = lineupFromSession(loaded.game.id);
        setSession(loaded);
        setLineup(slots);
        setBeat(reducePlay(initialBeat(), slots, { type: "status", status: loaded.status }));
        live = await LiveConnection.connect(fd);
        if (cancel) {
          live.close();
          return;
        }
        const nextRoom = live.subscribe<
          DicePublicView | QuizPublicView,
          DicePlayerView | QuizPlayerView
        >(sessionId);
        setRoom(nextRoom);
        setWallet(live.wallet ?? null);
        const apply = (status: SessionView["status"]) => {
          setBeat((current) => reducePlay(current, slots, { type: "status", status }));
        };
        nextRoom.on("snapshot", (snapshot) => {
          setViews({ publicView: snapshot.publicView, playerView: snapshot.playerView });
          apply(snapshot.status);
        });
        nextRoom.on("public", (view) => setViews((current) => ({ ...current, publicView: view })));
        nextRoom.on("player", ({ view }) =>
          setViews((current) => ({ ...current, playerView: view })),
        );
        nextRoom.on("status", ({ status }) => {
          if (status === "CANCELLED" || status === "FAILED") setEnded(status);
          else apply(status);
        });
        const tick = () => setNow(live?.now() ?? null);
        tick();
        timer = setInterval(tick, 250);
      } catch (caught) {
        if (!cancel) setLoadError(friendlyError(caught, "We couldn't open the game."));
      }
    })();
    return () => {
      cancel = true;
      if (timer) clearInterval(timer);
      live?.close();
    };
  }, [sessionId, attempt]);

  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const phase = views.publicView && "phase" in views.publicView ? views.publicView.phase : null;

  useEffect(() => {
    if (!lineup || beat.type !== "play" || phase !== "finished") return;
    const slots = lineup;
    const timer = setTimeout(() => {
      setBeat((current) => reducePlay(current, slots, { type: "slot-finished" }));
    }, 0);
    return () => clearTimeout(timer);
  }, [phase, beat, lineup]);

  useEffect(() => {
    if (beat.type === "settling" || beat.type === "results") {
      router.push(`/play/${sessionId}/results`);
    }
  }, [beat.type, router, sessionId]);

  const onCountdownDone = useCallback(() => {
    if (!lineup) return;
    setBeat((current) => reducePlay(current, lineup, { type: "countdown-done" }));
  }, [lineup]);

  const onSlotComplete = useCallback(() => {
    if (!lineup) return;
    setBeat((current) => reducePlay(current, lineup, { type: "slot-finished" }));
  }, [lineup]);

  if (ended && session) {
    return (
      <PlayMessage>
        <EmptyState
          icon="alert"
          title={
            ended === "CANCELLED" ? "This giveaway was cancelled" : "This game can't be played"
          }
          action={
            <Link href={`/g/${session.chainId}/${session.giveawayId}`}>
              <Button variant="secondary">Back to the giveaway</Button>
            </Link>
          }
        >
          {ended === "CANCELLED"
            ? "The host cancelled it, and the prize went back to them."
            : "Something stopped this game from running, so nobody can play it. Nobody was paid, the host gets the prize back, and nothing was taken from you."}
        </EmptyState>
      </PlayMessage>
    );
  }
  if (loadError) {
    return (
      <PlayMessage>
        <EmptyState
          icon="alert"
          title="We couldn't open the game"
          action={
            <Button
              onClick={() => {
                setLoadError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          }
        >
          {loadError}
        </EmptyState>
      </PlayMessage>
    );
  }
  if (!session || !lineup || now === null) {
    return (
      <PlayMessage>
        <div className="flex flex-col items-center gap-3 text-ink-muted" aria-busy>
          <Icon name="spinner" spin size={28} />
          <span>Opening the game…</span>
        </div>
      </PlayMessage>
    );
  }

  const slot = beat.type === "play" || beat.type === "next" ? lineup[beat.slot] : undefined;
  const toast = actionError ? <ActionToast>{actionError}</ActionToast> : null;
  const secondsLeft = (endsAt: number) => Math.max(0, Math.ceil((endsAt - now) / 1000));

  if (beat.type === "lobby") {
    return (
      <LobbyStage
        title="Get ready"
        seconds={Math.max(0, Math.ceil((Date.parse(session.startsAt) - now) / 1000))}
        games={lineup}
        players={session.playerCount}
        backHref={`/g/${session.chainId}/${session.giveawayId}`}
      />
    );
  }

  if (beat.type === "next" && slot) {
    return (
      <NextStage slot={slot} index={beat.slot + 1} total={lineup.length} onDone={onCountdownDone} />
    );
  }

  if (beat.type === "play" && slot?.id === "dice") {
    const player = views.playerView as DicePlayerView | null;
    const board = views.publicView as DicePublicView | null;
    const last = player?.rolls.at(-1) ?? [1, 1];
    const faces = rolling ? shownFaces : last;
    const best = player && player.rolls.length > 0 ? String(player.total) : "–";
    return (
      <>
        <DiceStage
          round={`Game ${beat.slot + 1} of ${lineup.length} · Roll ${Math.min((player?.rolls.length ?? 0) + 1, player ? player.rolls.length + player.remaining : 3)}`}
          seconds={
            board && board.phase !== "waiting"
              ? secondsLeft(board.endsAt)
              : secondsLeft(Date.parse(session.endsAt))
          }
          faces={faces}
          rolling={rolling}
          best={best}
          place={placeOf(
            board && "leaderboard" in board ? board.leaderboard : [],
            wallet ?? undefined,
          )}
          players={String(session.playerCount)}
          rollsLeft={player?.remaining ?? 1}
          hasNext={beat.slot + 1 < lineup.length}
          onRoll={() => {
            if (!room || rolling) return;
            setRolling(true);
            const timer = setInterval(() => {
              setShownFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
              playBlip(320);
            }, 70);
            void room
              .act({ type: "roll" })
              .catch((caught: unknown) => {
                setActionError(friendlyError(caught, "That roll didn't count. Try again."));
              })
              .finally(() => {
                clearInterval(timer);
                setRolling(false);
                playBlip(880);
              });
          }}
          onSlotComplete={onSlotComplete}
        />
        {toast}
      </>
    );
  }

  if (beat.type === "play" && slot?.id === "quiz") {
    const board = views.publicView as QuizPublicView | null;
    const player = views.playerView as QuizPlayerView | null;
    const question =
      board && (board.phase === "question" || board.phase === "reveal") ? board : null;
    const picked = player?.answers.at(-1)?.choice ?? null;
    const reveal = board?.phase === "reveal" ? board.answer : null;
    const feedback =
      board?.phase === "reveal"
        ? player?.answers.at(-1)?.correct
          ? copy.right
          : copy.wrong
        : copy.faster;
    const closes =
      board?.phase === "question"
        ? board.closesAt
        : board?.phase === "reveal"
          ? board.nextAt
          : Date.parse(session.endsAt);
    return (
      <>
        <QuizStage
          round={`Game ${beat.slot + 1} of ${lineup.length}${question ? ` · Question ${question.index + 1} of ${question.questionCount}` : ""}`}
          seconds={secondsLeft(closes)}
          prompt={question?.prompt ?? "Get ready"}
          choices={question?.choices ?? []}
          picked={board?.phase === "question" ? null : picked}
          reveal={reveal}
          feedback={feedback}
          onPick={(choice) => {
            if (!room || !question) return;
            playBlip(choice === reveal ? 880 : 220);
            void room
              .act({ type: "answer", question: question.index, choice })
              .catch((caught: unknown) => {
                setActionError(friendlyError(caught, "That answer didn't count."));
              });
          }}
        />
        {toast}
      </>
    );
  }

  return null;
}

function placeOf(board: { player: string; rank: number }[], me: string | undefined): string {
  if (!me) return "–";
  const row = board.find((entry) => entry.player === me);
  return row ? `#${row.rank}` : "–";
}

/** Full-screen message for the play route: logo bar and a centred column. */
function PlayMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <header className="px-4 py-3">
        <Link href="/" aria-label="FairDrops">
          <Logo size={24} />
        </Link>
      </header>
      <main className="flex flex-1 flex-col justify-center px-4 pb-16">{children}</main>
    </div>
  );
}

/** A rejected action, shown over the stage for a few seconds instead of replacing the game. */
function ActionToast({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-30 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-[440px] shadow-[var(--lift)]">
        <ErrorNote>{children}</ErrorNote>
      </div>
    </div>
  );
}
