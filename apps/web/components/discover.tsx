"use client";

import type { GiveawayView, LeaderboardsView } from "@fairdrops/shared";
import { rewardPlaces } from "@fairdrops/shared";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { ErrorNote } from "@/components/error-note";
import { GiveawayCard } from "@/components/giveaway-card";
import { LeaderboardsCard } from "@/components/leaderboards-card";
import { Shell } from "@/components/shell";
import type { GameKind, PlayerStatus } from "@/components/types";
import { copy } from "@/lib/copy";
import { chainName } from "@/lib/tokens";
import { useServerClock } from "@/lib/clock";
import {
  formatTokenAmount,
  secondsBetween,
  giveawayStatus,
  tokenDecimals,
  tokenSymbol,
} from "@/lib/format";
import { shortenWallet } from "@/lib/format";

const FILTERS = ["All", "Live now", "Starting soon", "Ending soon", "Finished"] as const;

export function Discover({
  items,
  error,
  boards,
}: {
  items: GiveawayView[];
  error: boolean;
  boards: LeaderboardsView | null;
}) {
  const now = useServerClock();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const cards = useMemo(() => items.map((item) => toCard(item, now)), [items, now]);
  const visible = cards.filter((card) => matches(filter, card.status));

  const live = cards.filter((card) => card.phase === "live").length;

  return (
    <Shell>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-2">
          {live > 0 ? (
            <span className="overline text-flare">
              {live} live {live === 1 ? "giveaway" : "giveaways"} now
            </span>
          ) : null}
          <h1 className="display-l m-0">Discover giveaways</h1>
          <p className="m-0 max-w-[56ch] text-pretty text-ink-muted">
            Play a short game for a real prize. Every result is checked, and anyone can verify it.
          </p>
        </div>
        <Link href="/host/new" className="self-start md:self-auto">
          <Button icon="gift">{copy.hostGiveaway}</Button>
        </Link>
      </header>

      <div
        className="-mx-4 mt-8 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
        role="tablist"
        aria-label="Filter giveaways"
      >
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={filter === item}
            onClick={() => setFilter(item)}
            className={
              filter === item
                ? "min-h-10 shrink-0 rounded-full bg-ink px-4 text-sm font-semibold whitespace-nowrap text-surface"
                : "min-h-10 shrink-0 rounded-full border border-line bg-surface-raised px-4 text-sm font-semibold whitespace-nowrap text-ink-muted hover:text-ink"
            }
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {error ? (
            <ErrorNote>
              We couldn&apos;t load giveaways right now. Check your connection and refresh.
            </ErrorNote>
          ) : null}
          {!error && visible.length === 0 ? (
            <EmptyState
              icon="gift"
              title={filter === "All" ? copy.emptyDiscover : `Nothing ${filter.toLowerCase()}`}
              action={
                filter === "All" ? (
                  <Link href="/host/new">
                    <Button>{copy.hostGiveaway}</Button>
                  </Link>
                ) : (
                  <Button variant="secondary" onClick={() => setFilter("All")}>
                    Show all giveaways
                  </Button>
                )
              }
            >
              {filter === "All"
                ? "Be the first: lock a prize and share the link."
                : "Try another filter, or check back soon."}
            </EmptyState>
          ) : null}
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            {visible.map((card) => (
              <GiveawayCard key={card.href} href={card.href} giveaway={card.giveaway} />
            ))}
          </div>
        </div>
        <LeaderboardsCard boards={boards} />
      </div>
    </Shell>
  );
}

function toCard(view: GiveawayView, now: number | null) {
  const status = giveawayStatus(view) ?? "ended";
  const games: GameKind[] = [];
  const gameId = view.metadata?.game.id;
  if (gameId === "dice" || gameId === "quiz" || gameId === "tap" || gameId === "custom")
    games.push(gameId);
  return {
    href: `/g/${view.chainId}/${view.giveawayId}`,
    phase: view.phase,
    status,
    giveaway: {
      host: shortenWallet(view.host),
      title: view.metadata?.title ?? "Giveaway",
      pool: formatTokenAmount(view.prize, tokenDecimals(view)),
      symbol: tokenSymbol(view),
      network: chainName(view.chainId),
      trust: view.tokenInfo?.trust ?? "unverified",
      winners: view.rewards ? rewardPlaces(view.rewards) : view.maxWinners,
      status,
      // Only a start can be counted down here (the list has no end times), and only while the
      // giveaway is really upcoming: a void or cancelled one shows no countdown at all.
      seconds:
        now !== null && status === "upcoming" ? secondsBetween(now, view.startTime) : undefined,
      games,
    },
  };
}

const OPEN: PlayerStatus[] = ["upcoming", "live", "ending"];

/**
 * By what a player can still do: "All" is what's open or still being settled, newest first;
 * everything over (won, unwon or called off) is under "Finished" only.
 */
function matches(filter: (typeof FILTERS)[number], status: PlayerStatus): boolean {
  switch (filter) {
    case "All":
      return OPEN.includes(status) || status === "settling";
    case "Live now":
      return status === "live" || status === "ending";
    case "Starting soon":
      return status === "upcoming";
    case "Ending soon":
      return status === "ending";
    case "Finished":
      return !OPEN.includes(status) && status !== "settling";
    default: {
      const neverFilter: never = filter;
      return neverFilter;
    }
  }
}
