"use client";

import type { GiveawayView } from "@fairdrops/shared";
import { rewardPlaces } from "@fairdrops/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppBar } from "@/components/app-bar";
import { Button } from "@/components/button";
import { Countdown } from "@/components/countdown";
import { FairBadge } from "@/components/fair-badge";
import { Icon } from "@/components/icon";
import { PrizeAmount } from "@/components/prize-amount";
import { Sheet } from "@/components/sheet";
import { StatusChip } from "@/components/status-chip";
import { gameIconName } from "@/components/avatar";
import { ErrorNote } from "@/components/error-note";
import { copy } from "@/lib/copy";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import {
  formatTokenAmount,
  formatWhen,
  placeAmounts,
  shortenWallet,
  giveawayStatus,
  tokenDecimals,
  tokenSymbol,
} from "@/lib/format";
import { gameHowTo, gameTitle, parseLineup } from "@/lib/play-director";
import { useServerClock } from "@/lib/clock";
import { connectInjectedWallet } from "@/lib/wallet";

export function GiveawayScreen({
  giveaway,
  players,
  endsAt,
}: {
  giveaway: GiveawayView;
  players: number;
  endsAt: string | null;
}) {
  const router = useRouter();
  const now = useServerClock();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = giveawayStatus(giveaway, {
    endsAtMs: endsAt ? Date.parse(endsAt) : undefined,
    nowMs: now ?? undefined,
  });
  const symbol = tokenSymbol(giveaway);
  const amount = formatTokenAmount(giveaway.prize, tokenDecimals(giveaway));
  const title = giveaway.metadata?.title ?? "Giveaway";
  const gameId = giveaway.metadata?.game.id ?? "custom";
  const games = gameId === "dice" || gameId === "quiz" ? parseLineup([gameId]) : [];
  const places = giveaway.rewards ? placeAmounts(BigInt(giveaway.prize), giveaway.rewards) : [];
  const winnerCount = giveaway.rewards ? rewardPlaces(giveaway.rewards) : giveaway.maxWinners;
  const seconds =
    now === null
      ? 0
      : giveaway.phase === "upcoming"
        ? Math.ceil((Date.parse(giveaway.startTime) - now) / 1000)
        : endsAt
          ? Math.ceil((Date.parse(endsAt) - now) / 1000)
          : 0;

  async function join() {
    if (!giveaway.session) return;
    setBusy(true);
    setNotice(null);
    try {
      const fd = browserFairDrops();
      try {
        await fd.auth.me();
      } catch {
        const wallet = await connectInjectedWallet(giveaway.chainId);
        await fd.auth.signIn(wallet, { chainId: giveaway.chainId, connector: "injected" });
      }
      await fd.sessions.join(giveaway.session.id);
      router.push(`/play/${giveaway.session.id}`);
    } catch (caught) {
      setNotice(friendlyError(caught, "Couldn't join. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const failed = giveaway.session?.status === "FAILED";
  const closed =
    failed ||
    giveaway.phase === "cancelled" ||
    giveaway.phase === "expired" ||
    giveaway.phase === "closed";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <AppBar logo />
      <div className="flex flex-1 flex-col gap-5 px-4 pb-28">
        <p className="caption m-0 text-ink-muted">Hosted by {shortenWallet(giveaway.host)}</p>
        <h1 className="display-l m-0 text-balance">{title}</h1>
        {status ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusChip
              status={status}
              label={
                giveaway.phase === "upcoming"
                  ? `Starts ${formatWhen(giveaway.startTime)}`
                  : undefined
              }
            />
            {now !== null && (status === "upcoming" || status === "live" || status === "ending") ? (
              <Countdown seconds={Math.max(0, seconds)} running size="m" label="in" />
            ) : null}
          </div>
        ) : (
          <ErrorNote>This giveaway can&apos;t be shown right now.</ErrorNote>
        )}
        <section className="rounded-lg border border-lagoon bg-lagoon-soft/40 p-4">
          <p className="overline m-0 text-lagoon">Prize pool</p>
          <PrizeAmount amount={amount} symbol={symbol} size="xl" />
          <p className="m-0 text-ink-muted">
            Top {winnerCount} players win.
            {giveaway.rewards?.kind === "weighted" ? " Bigger prizes for higher places." : ""}
          </p>
          <ol className="m-0 mt-3 list-none p-0">
            {places.slice(0, 3).map((place, index) => (
              <li key={index} className="flex items-center justify-between gap-3 py-1">
                <span>{index + 1}</span>
                <span className="h-2 flex-1 rounded-full bg-lagoon/30" />
                <span className="font-semibold text-lagoon">
                  {formatTokenAmount(place.toString(), tokenDecimals(giveaway))} {symbol}
                </span>
              </li>
            ))}
          </ol>
          {places.length > 3 ? (
            <p className="caption text-ink-muted">+{places.length - 3} more places</p>
          ) : null}
        </section>
        {games.length > 0 ? (
          <section>
            <h2 className="title-m">
              {games.length} {games.length === 1 ? "game" : "games"}
            </h2>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {games.map((game, index) => (
                <li key={game.id} className="flex flex-wrap items-center gap-3">
                  <span
                    className={`inline-grid size-10 place-items-center rounded-md text-on-stage stage-${game.id}`}
                  >
                    <Icon name={gameIconName(game.id)} />
                  </span>
                  <span>
                    <span className="block font-semibold">
                      {index + 1}. {gameTitle(game.id)}
                    </span>
                    <span className="caption text-ink-muted">{gameHowTo(game.id)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <p className="caption text-ink-muted">{players} joined</p>
        <FairBadge state="pending" />
        <p className="text-ink-muted">
          Scores are recorded as the game is played and checked before anyone is paid. You can check
          it yourself afterwards.
        </p>
        {giveaway.phase === "cancelled" ? (
          <ErrorNote>The host cancelled this giveaway. The prize went back to them.</ErrorNote>
        ) : null}
        {failed ? (
          <ErrorNote>
            This giveaway&apos;s game couldn&apos;t run, so it can&apos;t be played. Nobody is paid,
            and the host gets the prize back.
          </ErrorNote>
        ) : null}
        {notice && !open ? <ErrorNote>{notice}</ErrorNote> : null}
      </div>
      {!closed && status ? (
        <div className="sticky bottom-0 border-t border-line bg-surface px-4 py-3">
          <Button
            size="lg"
            block
            iconAfter="arrow"
            loading={busy}
            disabled={!giveaway.session || giveaway.phase === "settling"}
            onClick={() => setOpen(true)}
          >
            {giveaway.phase === "live" ? copy.joinNow : copy.join}
          </Button>
          <p className="caption mt-2 text-center text-ink-muted">{copy.freeToJoin}</p>
        </div>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen} title={`Join ${title}`}>
        <p className="m-0 text-ink-muted">{copy.signInReason}</p>
        <Button
          size="lg"
          block
          icon="wallet"
          loading={busy}
          onClick={() => {
            void join();
          }}
        >
          {copy.signIn.wallet}
        </Button>
        <Button size="lg" block variant="secondary" icon="users" disabled>
          {copy.continueGoogle}
        </Button>
        <Button size="lg" block variant="secondary" icon="send" disabled>
          {copy.continueEmail}
        </Button>
        <p className="caption text-center text-ink-muted">
          {copy.signIn.socialLater} {copy.signIn.note}
        </p>
        {notice ? <ErrorNote>{notice}</ErrorNote> : null}
      </Sheet>
    </div>
  );
}
