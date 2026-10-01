"use client";

import type { GiveawayView, Hex, SessionView } from "@fairdrops/shared";
import { LiveConnection } from "@fairdrops/sdk/live";
import { addFunds, cancelGiveaway, withdraw, withdrawable } from "@fairdrops/sdk/host";
import { NATIVE_TOKEN_ADDRESS } from "@fairdrops/shared";
import { parseUnits } from "viem";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { ErrorNote } from "@/components/error-note";
import { Field } from "@/components/field";
import { LeaderboardRow } from "@/components/leaderboard-row";
import { Sheet } from "@/components/sheet";
import { StatusChip } from "@/components/status-chip";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import {
  formatTokenAmount,
  shortenWallet,
  statusFromPhase,
  tokenDecimals,
  tokenSymbol,
} from "@/lib/format";
import { connectInjectedWallet } from "@/lib/wallet";

export function ManageGiveaway({
  giveaway,
  session,
}: {
  giveaway: GiveawayView;
  session: SessionView | null;
}) {
  const [extra, setExtra] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [owed, setOwed] = useState<string | null>(null);
  const [board, setBoard] = useState<{ player: string; score: number; rank: number }[]>([]);
  const status = statusFromPhase(giveaway.phase) ?? "ended";
  const symbol = tokenSymbol(giveaway);
  const beforeStart = giveaway.phase === "upcoming";
  const live = giveaway.phase === "live";

  useEffect(() => {
    let cancel = false;
    void withdrawable(giveaway.chainId, giveaway.giveawayId)
      .then((amount) => {
        if (!cancel) setOwed(formatTokenAmount(amount.toString(), tokenDecimals(giveaway)));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [giveaway]);

  useEffect(() => {
    if (!live || !session) return;
    let connection: LiveConnection | undefined;
    let cancel = false;
    void LiveConnection.connect(browserFairDrops(), { spectate: true })
      .then((liveConnection) => {
        if (cancel) {
          liveConnection.close();
          return;
        }
        connection = liveConnection;
        const room = liveConnection.subscribe(session.id);
        room.on("snapshot", ({ publicView }) => setBoard(readBoard(publicView)));
        room.on("public", (view) => setBoard(readBoard(view)));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
      connection?.close();
    };
  }, [live, session]);

  async function withWallet(
    run: (wallet: Awaited<ReturnType<typeof connectInjectedWallet>>) => Promise<void>,
  ) {
    setBusy(true);
    setError(null);
    try {
      const wallet = await connectInjectedWallet(giveaway.chainId);
      await run(wallet);
    } catch (caught) {
      setError(friendlyError(caught, "That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip status={status} />
      </div>
      <h1 className="display-l m-0">{giveaway.metadata?.title ?? "Giveaway"}</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Players" value={String(session?.playerCount ?? 0)} />
        <Stat
          label="Prize pool"
          value={`${formatTokenAmount(giveaway.prize, tokenDecimals(giveaway))} ${symbol}`}
        />
        <Stat label="Winners" value={String(giveaway.maxWinners)} />
      </div>
      {beforeStart ? (
        <>
          <Field
            label="Add to the prize"
            inputMode="decimal"
            suffix={symbol}
            value={extra}
            onChange={(event) => setExtra(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                void withWallet(async (wallet) => {
                  await addFunds(
                    wallet,
                    giveaway.chainId,
                    giveaway.giveawayId,
                    NATIVE_TOKEN_ADDRESS,
                    parseUnits(extra || "0", tokenDecimals(giveaway)),
                  );
                  setExtra("");
                })
              }
            >
              Add to the prize
            </Button>
            <Link href={`/host/${giveaway.chainId}/${giveaway.giveawayId}/share`}>Share again</Link>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Cancel and refund
            </Button>
          </div>
          <p className="caption text-ink-muted">
            You can add to the prize or cancel until it starts. After that the giveaway runs on its
            own.
          </p>
        </>
      ) : null}
      {live ? (
        <section>
          <h2 className="title-m">Live leaderboard</h2>
          <ol className="m-0 list-none p-0">
            {board.slice(0, 5).map((row) => (
              <LeaderboardRow
                key={row.player}
                rank={row.rank}
                name={shortenWallet(row.player)}
                score={String(row.score)}
              />
            ))}
          </ol>
        </section>
      ) : null}
      {!beforeStart && !live && owed && owed !== "0" ? (
        <Button
          size="lg"
          loading={busy}
          onClick={() =>
            void withWallet(async (wallet) => {
              await withdraw(wallet, giveaway.chainId, giveaway.giveawayId);
            })
          }
        >
          Withdraw {owed} {symbol}
        </Button>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Sheet open={confirm} onOpenChange={setConfirm} title="Cancel this giveaway?">
        <p>The prize comes back to your wallet. Players will see it was cancelled.</p>
        <Button
          variant="danger"
          loading={busy}
          onClick={() =>
            void withWallet(async (wallet) => {
              await cancelGiveaway(wallet, giveaway.chainId, giveaway.giveawayId);
              setConfirm(false);
            })
          }
        >
          Cancel and refund
        </Button>
      </Sheet>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="caption m-0 text-ink-muted">{label}</p>
      <p className="m-0 font-semibold">{value}</p>
    </div>
  );
}

function readBoard(view: unknown): { player: string; score: number; rank: number }[] {
  if (!view || typeof view !== "object" || !("leaderboard" in view)) return [];
  const board = (view as { leaderboard?: unknown }).leaderboard;
  if (!Array.isArray(board)) return [];
  return board.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as { player?: unknown; score?: unknown; rank?: unknown };
    if (
      typeof row.player !== "string" ||
      typeof row.score !== "number" ||
      typeof row.rank !== "number"
    )
      return [];
    return [{ player: row.player, score: row.score, rank: row.rank }];
  });
}

export type { Hex };
