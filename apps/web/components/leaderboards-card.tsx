"use client";

import type { LeaderboardEntry, LeaderboardsView } from "@fairdrops/shared";
import { useState } from "react";
import { Segmented } from "./segmented";
import { formatTokenAmount, shortenWallet } from "@/lib/format";
import { formatReference } from "@/lib/prices";

type Board = "winners" | "hosts";

/**
 * All-time top winners and hosts. It changes only when a giveaway's result is final, which the
 * copy says, so an empty board reads as "nothing finished yet" rather than broken. Live scores
 * are on each game's own board.
 */
export function LeaderboardsCard({ boards }: { boards: LeaderboardsView | null }) {
  const [board, setBoard] = useState<Board>("winners");
  const entries = boards?.[board] ?? [];
  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised p-5">
      <div className="flex flex-col gap-1">
        <h2 className="title-m m-0">Leaderboards</h2>
        <p className="caption m-0 text-ink-muted">All time. Updates when a giveaway ends.</p>
      </div>
      <Segmented
        label="Leaderboard"
        value={board}
        onChange={(value) => setBoard(value as Board)}
        options={[
          { value: "winners", label: "Top winners" },
          { value: "hosts", label: "Top hosts" },
        ]}
      />
      {boards === null ? (
        <p className="m-0 text-ink-muted">The leaderboards can&apos;t be loaded right now.</p>
      ) : entries.length === 0 ? (
        <div className="flex flex-col gap-3">
          <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-hidden>
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex items-center gap-3 opacity-60">
                <span className="w-5 font-mono text-sm font-bold text-ink-faint">{row + 1}</span>
                <span className="size-8 rounded-full bg-surface-sunken" />
                <span className="h-3 flex-1 rounded-full bg-surface-sunken" />
              </li>
            ))}
          </ol>
          <p className="m-0 text-ink-muted">
            {board === "winners"
              ? "No prizes have been won yet. Winners show up here once a giveaway ends and its prizes are paid."
              : "No giveaway has paid out yet. Hosts show up here once one of their giveaways ends."}
          </p>
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {entries.map((entry) => (
            <Row key={entry.account} entry={entry} board={board} />
          ))}
        </ol>
      )}
    </aside>
  );
}

function Row({ entry, board }: { entry: LeaderboardEntry; board: Board }) {
  const only = entry.amounts.length === 1 ? entry.amounts[0] : undefined;
  const fallback = only
    ? `${formatTokenAmount(only.amount, only.tokenInfo?.decimals ?? 0)} ${only.tokenInfo?.symbol ?? "units"}`
    : `${entry.amounts.length} tokens`;
  return (
    <li className="flex items-center gap-3 rounded-md py-1.5">
      <span className="w-5 font-mono text-sm font-bold text-ink-muted">{entry.rank}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-sm">{shortenWallet(entry.account)}</span>
        <span className="caption text-ink-muted">
          {entry.count}{" "}
          {board === "winners"
            ? entry.count === 1
              ? "prize"
              : "prizes"
            : entry.count === 1
              ? "giveaway"
              : "giveaways"}
        </span>
      </span>
      <span className="shrink-0 text-right font-semibold text-lagoon tabular-nums">
        {entry.value > 0 ? formatReference(entry.value) : fallback}
      </span>
    </li>
  );
}
