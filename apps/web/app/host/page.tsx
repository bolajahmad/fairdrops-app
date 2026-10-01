"use client";

import { findChain, type GiveawayView } from "@fairdrops/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { ErrorNote } from "@/components/error-note";
import { Shell, StickyBar } from "@/components/shell";
import { SignInPanel } from "@/components/sign-in-panel";
import { StatusChip } from "@/components/status-chip";
import { useAccount } from "@/lib/account";
import { copy } from "@/lib/copy";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import {
  formatTokenAmount,
  formatWhen,
  shortenWallet,
  giveawayStatus,
  tokenDecimals,
  tokenSymbol,
} from "@/lib/format";

export default function HostHomePage() {
  const account = useAccount();
  const [items, setItems] = useState<GiveawayView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wallet = account.state.status === "signedIn" ? account.state.me.wallet : null;

  useEffect(() => {
    if (!wallet) return;
    browserFairDrops()
      .giveaways.list({ host: wallet, limit: 50 })
      .then((page) => setItems(page.items))
      .catch((caught: unknown) => {
        setItems([]);
        setError(friendlyError(caught, "Couldn't load your giveaways."));
      });
  }, [wallet]);

  const list = items ?? [];
  const given = new Map<string, { amount: bigint; decimals: number }>();
  for (const item of list) {
    const symbol = tokenSymbol(item);
    const current = given.get(symbol) ?? { amount: 0n, decimals: tokenDecimals(item) };
    current.amount += BigInt(item.prize);
    given.set(symbol, current);
  }
  const live = list.filter((item) => item.phase === "live" || item.phase === "upcoming").length;

  const create = (
    <Link href="/host/new">
      <Button size="lg" icon="gift">
        {copy.createGiveaway}
      </Button>
    </Link>
  );

  return (
    <Shell>
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="display-l m-0">Hosting</h1>
          <p className="m-0 text-ink-muted">Lock a prize, share a link, let people play for it.</p>
        </div>
        <div className="hidden items-center gap-4 md:flex">
          {wallet ? (
            <Button size="sm" variant="ghost" onClick={() => void account.signOut()}>
              {copy.signIn.signOut} · {shortenWallet(wallet)}
            </Button>
          ) : null}
          {create}
        </div>
      </header>

      <div className="mt-10 flex flex-col gap-8">
        {account.state.status === "signedOut" ? (
          <SignInPanel
            title={copy.signIn.hostingTitle}
            reason={copy.signIn.hostingReason}
            busy={account.busy}
            error={account.error}
            onWallet={() => void account.signInWithWallet()}
          />
        ) : null}

        {account.state.status === "loading" || (wallet && items === null) ? (
          <div className="grid gap-3 sm:grid-cols-3" aria-busy>
            {[0, 1, 2].map((tile) => (
              <div key={tile} className="h-24 animate-pulse rounded-lg bg-surface-sunken" />
            ))}
          </div>
        ) : null}

        {wallet && items !== null && list.length === 0 ? (
          <EmptyState icon="gift" title="You haven't hosted a giveaway yet" action={create}>
            It takes about a minute. Pick who it&apos;s for, set the prize, and share the link.
          </EmptyState>
        ) : null}

        {list.length > 0 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Given away">
                <span className="flex flex-col">
                  {[...given.entries()].map(([symbol, total]) => (
                    <span key={symbol} className="font-display text-2xl font-extrabold text-lagoon">
                      {formatTokenAmount(total.amount.toString(), total.decimals)}{" "}
                      <span className="text-base">{symbol}</span>
                    </span>
                  ))}
                </span>
              </Tile>
              <Tile label="Giveaways">
                <span className="font-display text-2xl font-extrabold">{list.length}</span>
              </Tile>
              <Tile label="Upcoming or live">
                <span className="font-display text-2xl font-extrabold">{live}</span>
              </Tile>
            </div>

            <section className="overflow-hidden rounded-lg border border-line bg-surface-raised">
              <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_6rem] gap-4 border-b border-line px-5 py-3 text-sm font-semibold text-ink-muted md:grid">
                <span>Giveaway</span>
                <span>Status</span>
                <span className="text-right">Prize</span>
                <span />
              </div>
              <ul className="m-0 list-none divide-y divide-line p-0">
                {list.map((item) => {
                  const status = giveawayStatus(item) ?? "ended";
                  return (
                    <li
                      key={`${item.chainId}-${item.giveawayId}`}
                      className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_6rem] md:items-center md:gap-4"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">
                          {item.metadata?.title ?? "Giveaway"}
                        </span>
                        <span className="caption truncate text-ink-muted">
                          {findChain(item.chainId)?.name ?? `Chain ${item.chainId}`} · starts{" "}
                          {formatWhen(item.startTime)}
                        </span>
                      </span>
                      <span>
                        <StatusChip status={status} />
                      </span>
                      <span className="font-display font-extrabold text-lagoon tabular-nums md:text-right">
                        {formatTokenAmount(item.prize, tokenDecimals(item))} {tokenSymbol(item)}
                      </span>
                      <Link href={`/host/${item.chainId}/${item.giveawayId}`}>
                        <Button size="sm" variant="secondary" className="w-full">
                          Manage
                        </Button>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>

      <StickyBar mobileOnly>
        <Link href="/host/new" className="fd-bar-action">
          <Button size="lg" block icon="gift">
            {copy.createGiveaway}
          </Button>
        </Link>
      </StickyBar>
    </Shell>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-5">
      <span className="caption text-ink-muted">{label}</span>
      {children}
    </div>
  );
}
