"use client";

import type { GiveawayView, Hex, SessionView, SettlementView } from "@fairdrops/shared";
import { LiveConnection } from "@fairdrops/sdk/live";
import { addFunds, cancelGiveaway, withdraw, withdrawable } from "@fairdrops/sdk/host";
import { parseUnits } from "viem";
import { useEffect, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { ErrorNote } from "@/components/error-note";
import { Field } from "@/components/field";
import { TokenFacts } from "@/components/token-facts";
import { chainName } from "@/lib/tokens";
import { LeaderboardRow } from "@/components/leaderboard-row";
import { Sheet } from "@/components/sheet";
import { ShareButton } from "@/components/share-button";
import { FairBadge } from "@/components/fair-badge";
import Link from "next/link";
import { StatusChip } from "@/components/status-chip";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import {
  formatTokenAmount,
  shortenWallet,
  giveawayStatus,
  tokenDecimals,
  tokenSymbol,
} from "@/lib/format";
import { connectWallet } from "@/lib/wallet";
import {
  addFundsGasFree,
  cancelGasFree,
  gasFreeEnabled,
  hostsGasFree,
  quoteWithdraw,
  withdrawToWallet,
} from "@/lib/gas-free";
import { PayoutSheet } from "@/components/payout-sheet";

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
  const [owed, setOwed] = useState<bigint | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [board, setBoard] = useState<{ player: string; score: number; rank: number }[]>([]);
  // The same status players see, including games that ended with no winners.
  const status = giveawayStatus(giveaway) ?? "ended";
  const [settlement, setSettlement] = useState<SettlementView | null>(null);
  const finished = giveaway.phase === "claimable" || giveaway.phase === "closed";
  const symbol = tokenSymbol(giveaway);
  const beforeStart = giveaway.phase === "upcoming";
  const live = giveaway.phase === "live";

  useEffect(() => {
    let cancel = false;
    void withdrawable(giveaway.chainId, giveaway.giveawayId)
      .then((amount) => {
        if (!cancel) setOwed(amount);
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

  useEffect(() => {
    if (!finished || !session) return;
    let live = true;
    browserFairDrops()
      .settlement.get(session.id)
      .then((found) => live && setSettlement(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [finished, session]);

  async function withdrawYourself(wallet: Awaited<ReturnType<typeof connectWallet>>) {
    await withdraw(wallet, giveaway.chainId, giveaway.giveawayId);
    setOwed(0n);
  }

  async function withWallet(
    run: (wallet: Awaited<ReturnType<typeof connectWallet>>) => Promise<void>,
  ) {
    setBusy(true);
    setError(null);
    try {
      const wallet = await connectWallet(giveaway.chainId);
      await run(wallet);
    } catch (caught) {
      setError(friendlyError(caught, "That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <BackLink fallback="/host" label="Your giveaways" />
      <div className="flex items-center justify-between gap-3">
        <StatusChip status={status} />
        <ShareButton
          path={`/g/${giveaway.chainId}/${giveaway.giveawayId}`}
          title={giveaway.metadata?.title ?? "Giveaway"}
        />
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
      {giveaway.tokenInfo ? <TokenFacts token={giveaway.tokenInfo} /> : null}
      {beforeStart ? (
        <>
          <Field
            label="Add to the prize"
            inputMode="decimal"
            suffix={symbol}
            value={extra}
            disabled={!giveaway.tokenInfo}
            hint={
              giveaway.tokenInfo
                ? `In ${giveaway.tokenInfo.symbol} on ${chainName(giveaway.chainId)}.`
                : "This token's decimals couldn't be read, so adding to the prize is disabled."
            }
            onChange={(event) => setExtra(event.target.value.replace(/[^0-9.]/g, ""))}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={busy}
              disabled={!giveaway.tokenInfo || !extra}
              onClick={() => {
                const token = giveaway.tokenInfo;
                if (!token) return;
                // The giveaway's own token and its real decimals: never a default.
                const amount = parseUnits(extra || "0", token.decimals);
                void withWallet(async (wallet) => {
                  if (hostsGasFree()) {
                    await addFundsGasFree({
                      chainId: giveaway.chainId,
                      giveawayId: giveaway.giveawayId,
                      token: giveaway.token,
                      amount,
                    });
                  } else {
                    await addFunds(
                      wallet,
                      giveaway.chainId,
                      giveaway.giveawayId,
                      giveaway.token,
                      amount,
                    );
                  }
                  setExtra("");
                });
              }}
            >
              Add to the prize
            </Button>
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
          {board.length === 0 ? (
            <p className="m-0 text-ink-muted">Scores show up here as people play.</p>
          ) : null}
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
      {finished && session ? (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="title-m m-0">Results</h2>
            <FairBadge
              state="verified"
              href={`/g/${giveaway.chainId}/${giveaway.giveawayId}/verify`}
            />
          </div>
          {settlement ? (
            <>
              <p className="m-0 text-ink-muted">
                {settlement.winnerCount} {settlement.winnerCount === 1 ? "winner" : "winners"}{" "}
                shared {formatTokenAmount(settlement.totalPayout, tokenDecimals(giveaway))} {symbol}
                .
              </p>
              <ol className="m-0 flex list-none flex-col gap-1 p-0">
                {settlement.payouts.map((payout) => (
                  <li
                    key={payout.account}
                    className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0"
                  >
                    <span className="flex items-center gap-3">
                      <span className="w-6 font-mono text-sm text-ink-muted">#{payout.rank}</span>
                      <span className="font-mono text-sm">{shortenWallet(payout.account)}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-semibold text-lagoon tabular-nums">
                        {formatTokenAmount(payout.amount, tokenDecimals(giveaway))} {symbol}
                      </span>
                      <span className="caption w-20 text-right text-ink-muted">
                        {payout.claimedAt ? "Collected" : "Not yet"}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="m-0 text-ink-muted">Loading the results…</p>
          )}
          <Link href={`/play/${session.id}/results`} className="self-start">
            <Button variant="secondary" size="sm" iconAfter="arrow">
              See the final board
            </Button>
          </Link>
        </section>
      ) : null}
      {!beforeStart && !live && owed ? (
        <Button
          size="lg"
          loading={busy}
          onClick={() => {
            if (gasFreeEnabled()) setWithdrawing(true);
            else void withWallet(withdrawYourself);
          }}
        >
          Withdraw {formatTokenAmount(owed.toString(), tokenDecimals(giveaway))} {symbol}
        </Button>
      ) : null}
      {owed && withdrawing ? (
        <PayoutSheet
          open
          onOpenChange={setWithdrawing}
          title="Withdraw to a wallet"
          amount={owed}
          decimals={tokenDecimals(giveaway)}
          symbol={symbol}
          self={giveaway.host}
          loadQuote={() =>
            quoteWithdraw({
              chainId: giveaway.chainId,
              host: giveaway.host,
              token: giveaway.token,
              owed,
            })
          }
          confirmLabel="Withdraw"
          busyLabel="Withdrawing"
          onConfirm={async (recipient, quote) => {
            await withdrawToWallet({
              chainId: giveaway.chainId,
              giveawayId: giveaway.giveawayId,
              token: giveaway.token,
              owed,
              recipient,
              quote,
            });
            setOwed(0n);
          }}
          fallback={{
            label: "Pay the network fee yourself",
            run: async () => withdrawYourself(await connectWallet(giveaway.chainId)),
          }}
        />
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Sheet open={confirm} onOpenChange={setConfirm} title="Cancel this giveaway?">
        <p>
          The prize comes back to your wallet
          {hostsGasFree() ? ", less a small network fee in the same token" : ""}. Players will see
          it was cancelled.
        </p>
        <Button
          variant="danger"
          loading={busy}
          onClick={() =>
            void withWallet(async (wallet) => {
              if (hostsGasFree()) {
                await cancelGasFree({
                  chainId: giveaway.chainId,
                  giveawayId: giveaway.giveawayId,
                  token: giveaway.token,
                  prize: BigInt(giveaway.prize),
                });
              } else {
                await cancelGiveaway(wallet, giveaway.chainId, giveaway.giveawayId);
              }
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
  // A rounds game nests the current round's view.
  if (view && typeof view === "object" && (view as { kind?: unknown }).kind === "rounds") {
    return readBoard((view as { view?: unknown }).view);
  }
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
