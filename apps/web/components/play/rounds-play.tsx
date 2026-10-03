"use client";

import type {
  DicePlayerView,
  DicePublicView,
  QuizPlayerView,
  QuizPublicView,
  RoundsPlayerView,
  RoundsPublicView,
} from "@fairdrops/game-kit";
import type { SessionView } from "@fairdrops/sdk";
import { LiveConnection, type Room } from "@fairdrops/sdk/live";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Countdown } from "@/components/countdown";
import { ErrorNote } from "@/components/error-note";
import { Icon } from "@/components/icon";
import { AppBar } from "@/components/app-bar";
import { gameIconName } from "@/components/avatar";
import { copy } from "@/lib/copy";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import { shortenWallet } from "@/lib/format";
import { gameHowTo, gameTitle, type PlayableGameId } from "@/lib/play-director";
import { playBlip } from "@/lib/sound";
import { PlayingElsewhere } from "./displaced";
import { LobbyStage } from "./lobby";
import { DiceStage, QuizStage } from "./stages";

const playable = (id: string): id is PlayableGameId => id === "dice" || id === "quiz";

/**
 * A giveaway played in rounds: back-to-back rounds of Dice or Quiz until every prize is won.
 * Between rounds there's a short break showing who just won, how many prizes are left and the
 * next game; people can join or sit out there.
 */
export function RoundsPlay({ session }: { session: SessionView }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room<RoundsPublicView, RoundsPlayerView> | null>(null);
  const [status, setStatus] = useState(session.status);
  const [board, setBoard] = useState<RoundsPublicView | null>(null);
  const [me, setMe] = useState<RoundsPlayerView | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [shownFaces, setShownFaces] = useState<number[]>([1, 1]);
  const [elsewhere, setElsewhere] = useState(false);

  useEffect(() => {
    let cancel = false;
    let live: LiveConnection | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      try {
        live = await LiveConnection.connect(browserFairDrops());
        if (cancel) return live.close();
        const next = live.subscribe<RoundsPublicView, RoundsPlayerView>(session.id);
        setRoom(next);
        setWallet(live.wallet ?? null);
        next.on("snapshot", (snapshot) => {
          setStatus(snapshot.status);
          setBoard(snapshot.publicView);
          setMe(snapshot.playerView);
        });
        next.on("public", (view) => setBoard(view));
        next.on("displaced", () => setElsewhere(true));
        next.on("player", ({ view }) => setMe(view));
        next.on("status", ({ status: changed }) => setStatus(changed));
        const tick = () => setNow(live?.now() ?? Date.now());
        tick();
        timer = setInterval(tick, 250);
      } catch (caught) {
        if (!cancel) setError(friendlyError(caught, "We couldn't open the game."));
      }
    })();
    return () => {
      cancel = true;
      if (timer) clearInterval(timer);
      live?.close();
    };
  }, [session.id]);

  useEffect(() => {
    if (["SETTLING", "FINALIZING", "FINALIZED"].includes(status)) {
      router.replace(`/play/${session.id}/results`);
    }
  }, [status, router, session.id]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const lineup = ((session.config.games as { id: string }[] | undefined) ?? [])
    .map((game) => game.id)
    .filter(playable)
    .map((id) => ({ id }));
  const giveawayHref = `/g/${session.chainId}/${session.giveawayId}`;
  const toast = (
    <>
      {error ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-30 flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-[440px] shadow-[var(--lift)]">
            <ErrorNote>{error}</ErrorNote>
          </div>
        </div>
      ) : null}
      {elsewhere ? (
        <PlayingElsewhere
          onPlayHere={() => {
            room?.claim();
            setElsewhere(false);
          }}
        />
      ) : null}
    </>
  );

  async function join() {
    setBusy(true);
    try {
      await browserFairDrops().sessions.join(session.id);
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't join. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function sitOut() {
    if (!room) return;
    setBusy(true);
    try {
      await room.act({ roster: "leave" });
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't sit out. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (status !== "RUNNING" || !board || now === null) {
    return (
      <>
        <LobbyStage
          title="Get ready"
          seconds={Math.max(0, Math.ceil((Date.parse(session.startsAt) - (now ?? 0)) / 1000))}
          games={lineup}
          players={session.playerCount}
          backHref={giveawayHref}
          sessionId={session.id}
          giveaway={{ chainId: session.chainId, giveawayId: session.giveawayId }}
        />
        {toast}
      </>
    );
  }

  const left = Math.max(0, board.places - board.awards.length);
  const label = `Round ${board.round + 1} of up to ${board.maxRounds} · ${left} ${left === 1 ? "prize" : "prizes"} left`;
  const secondsTo = (at: number) => Math.max(0, Math.ceil((at - now) / 1000));
  const game = board.game.id;

  if (board.phase === "playing" && me?.playing && game === "dice") {
    const player = me.view as DicePlayerView | null;
    const view = board.view as DicePublicView | null;
    const last = player?.rolls.at(-1) ?? [1, 1];
    const leaders = view && "leaderboard" in view ? view.leaderboard : [];
    const place = leaders.find((entry) => entry.player === wallet)?.rank;
    return (
      <>
        <DiceStage
          round={label}
          seconds={secondsTo(board.endsAt)}
          faces={rolling ? shownFaces : last}
          rolling={rolling}
          best={player && player.rolls.length > 0 ? String(player.total) : "–"}
          place={place ? `#${place}` : "–"}
          players={String(view && "rolledPlayers" in view ? view.rolledPlayers : "–")}
          rollsLeft={player?.remaining ?? 1}
          hasNext={false}
          onRoll={() => {
            if (!room || rolling) return;
            setRolling(true);
            const spin = setInterval(() => {
              setShownFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
              playBlip(320);
            }, 70);
            void room
              .act({ type: "roll" })
              .catch((caught: unknown) =>
                setError(friendlyError(caught, "That roll didn't count. Try again.")),
              )
              .finally(() => {
                clearInterval(spin);
                setRolling(false);
                playBlip(880);
              });
          }}
          onSlotComplete={() => undefined}
        />
        {toast}
      </>
    );
  }

  if (board.phase === "playing" && me?.playing && game === "quiz") {
    const view = board.view as QuizPublicView | null;
    const player = me.view as QuizPlayerView | null;
    const question = view && (view.phase === "question" || view.phase === "reveal") ? view : null;
    const reveal = view?.phase === "reveal" ? view.answer : null;
    const picked = player?.answers.find((answer) => answer.question === question?.index);
    return (
      <>
        <QuizStage
          round={`${label}${question ? ` · Question ${question.index + 1} of ${question.questionCount}` : ""}`}
          seconds={secondsTo(
            view?.phase === "question"
              ? view.closesAt
              : view?.phase === "reveal"
                ? view.nextAt
                : board.endsAt,
          )}
          prompt={question?.prompt ?? "Get ready"}
          choices={question?.choices ?? []}
          picked={picked ? picked.choice : null}
          reveal={reveal}
          feedback={
            view?.phase === "reveal" ? (picked?.correct ? copy.right : copy.wrong) : copy.faster
          }
          onPick={(choice) => {
            if (!room || !question) return;
            playBlip(520);
            void room
              .act({ type: "answer", question: question.index, choice })
              .catch((caught: unknown) =>
                setError(friendlyError(caught, "That answer didn't count.")),
              );
          }}
        />
        {toast}
      </>
    );
  }

  // A break, the end, or a round this person isn't in.
  // Joined while a round is on: wait in the lobby, counting down to the round they're in.
  if (board.phase === "playing" && me?.joined && !me.playing && board.next) {
    const nextId = board.next.game.id;
    return (
      <>
        <LobbyStage
          title="Next round"
          seconds={secondsTo(board.next.startsAt)}
          games={playable(nextId) ? [{ id: nextId }] : lineup}
          players={session.playerCount}
          backHref={giveawayHref}
          sessionId={session.id}
          giveaway={{ chainId: session.chainId, giveawayId: session.giveawayId }}
          note="A round is on. You're in from the next one."
        />
        {toast}
      </>
    );
  }

  const previous = board.phase === "playing" ? board.round : board.round - 1;
  const justWon = board.awards.filter((award) => award.round === previous);
  const over = board.phase === "over";
  const nextGame = playable(game) ? game : null;
  const waitingFor = board.phase === "playing" ? board.endsAt : board.startsAt;

  return (
    <div className={`on-stage flex min-h-dvh flex-col stage-${nextGame ?? "custom"}`}>
      <AppBar title={over ? "Every prize is won" : "Between rounds"} backHref={giveawayHref} />
      <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 pb-10">
        {over ? (
          <div className="flex flex-col gap-2">
            <h1 className="display-l m-0">That&apos;s a wrap</h1>
            <p className="body-l m-0 text-on-stage/80">
              All {board.places} prizes went in {board.round + 1}{" "}
              {board.round === 0 ? "round" : "rounds"}. We&apos;re checking the scores now.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <span className="overline text-on-stage/70">{label}</span>
            <h1 className="display-l m-0">
              {board.phase === "playing"
                ? me?.joined
                  ? "You're in from the next round"
                  : "A round is on"
                : nextGame
                  ? `Next up: ${gameTitle(nextGame)}`
                  : "Next round soon"}
            </h1>
            {nextGame && board.phase !== "playing" ? (
              <p className="body-l m-0 flex items-center gap-2 text-on-stage/80">
                <Icon name={gameIconName(nextGame)} size={20} />
                {gameHowTo(nextGame)}
              </p>
            ) : null}
            <Countdown
              seconds={secondsTo(waitingFor)}
              running
              size="l"
              urgentAt={3}
              onStage
              label={board.phase === "playing" ? "this round ends in" : "starts in"}
              tone={board.phase === "playing" ? "cutoff" : "start"}
            />
          </div>
        )}

        {justWon.length > 0 ? (
          <section className="flex flex-col gap-2 rounded-lg bg-white/10 p-4">
            <span className="overline text-on-stage/70">
              {previous === board.round && board.phase === "over"
                ? "Last round's winners"
                : `Round ${previous + 1} winners`}
            </span>
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {justWon.map((award, index) => (
                <li key={`${award.player}-${index}`} className="flex justify-between gap-3">
                  <span className="font-mono text-sm">
                    {award.player === wallet ? "You" : shortenWallet(award.player)}
                  </span>
                  <span className="font-semibold tabular-nums">{award.score} pts</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {me && me.wins > 0 ? (
          <p className="body-strong m-0 flex items-center gap-2">
            <Icon name="trophy" size={20} />
            You&apos;ve won {me.wins} {me.wins === 1 ? "prize" : "prizes"}
            {board.maxWinsPerPlayer !== null ? ` of up to ${board.maxWinsPerPlayer}` : ""}.
          </p>
        ) : null}

        {!over ? (
          <div className="mt-auto flex flex-col gap-2">
            {me?.joined ? (
              <>
                <p className="caption m-0 text-center text-on-stage/80">
                  You&apos;re playing the next round.
                </p>
                <Button variant="secondary" block loading={busy} onClick={() => void sitOut()}>
                  Sit out the next rounds
                </Button>
              </>
            ) : (
              <Button size="lg" block loading={busy} onClick={() => void join()}>
                Join the next round
              </Button>
            )}
          </div>
        ) : null}
      </main>
      {toast}
    </div>
  );
}
