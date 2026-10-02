"use client";

import { findChain, referenceValue, type GiveawayView } from "@fairdrops/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { ErrorNote } from "@/components/error-note";
import { Shell, StickyBar } from "@/components/shell";
import { SignInPanel } from "@/components/sign-in-panel";
import { Icon } from "@/components/icon";
import { StatusChip } from "@/components/status-chip";
import { TokenAvatar } from "@/components/token-avatar";
import { useAccount } from "@/lib/account";
import { chainName, tokenKey } from "@/lib/tokens";
import { copy } from "@/lib/copy";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import { formatReference, usePrices } from "@/lib/prices";
import { cn } from "@/lib/cn";
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
  const [breakdown, setBreakdown] = useState(false);
  const prices = usePrices();
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
  const valueOf = (item: GiveawayView): number | null =>
    prices
      ? referenceValue(
          { chainId: item.chainId, address: item.token },
          item.prize,
          tokenDecimals(item),
          prices,
        )
      : null;
  // Refunded giveaways gave nothing away. Per token, not per symbol: USDC on two networks are
  // two different tokens.
  const given = new Map<
    string,
    { amount: bigint; decimals: number; symbol: string; chainId: number; value: number | null }
  >();
  for (const item of list) {
    if (item.phase === "cancelled" || item.phase === "expired") continue;
    const id = tokenKey({ chainId: item.chainId, address: item.token });
    const current = given.get(id) ?? {
      amount: 0n,
      decimals: tokenDecimals(item),
      symbol: tokenSymbol(item),
      chainId: item.chainId,
      value: 0,
    };
    current.amount += BigInt(item.prize);
    const value = valueOf(item);
    current.value = value === null || current.value === null ? null : current.value + value;
    given.set(id, current);
  }
  const totals = [...given.entries()];
  const priced = totals.filter(([, total]) => total.value !== null);
  const unpriced = totals.length - priced.length;
  const totalValue = priced.reduce((sum, [, total]) => sum + (total.value ?? 0), 0);
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
                {prices && priced.length > 0 ? (
                  <span className="font-display text-2xl font-extrabold text-lagoon tabular-nums">
                    {formatReference(totalValue)}
                  </span>
                ) : (
                  <span className="font-display text-2xl font-extrabold text-lagoon">
                    {totals.length} {totals.length === 1 ? "token" : "tokens"}
                  </span>
                )}
                {totals.length > 0 ? (
                  <button
                    type="button"
                    aria-expanded={breakdown}
                    aria-controls="given-breakdown"
                    onClick={() => setBreakdown((open) => !open)}
                    className="-ml-2 inline-flex min-h-9 cursor-pointer items-center gap-1 self-start rounded-full px-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                  >
                    {unpriced > 0 && priced.length > 0
                      ? `+ ${unpriced} without a price · Breakdown`
                      : "Breakdown"}
                    <Icon
                      name="chevron"
                      size={16}
                      className={cn("transition-transform", breakdown && "rotate-180")}
                    />
                  </button>
                ) : null}
              </Tile>
              <Tile label="Giveaways">
                <span className="font-display text-2xl font-extrabold">{list.length}</span>
              </Tile>
              <Tile label="Upcoming or live">
                <span className="font-display text-2xl font-extrabold">{live}</span>
              </Tile>
            </div>

            <div
              id="given-breakdown"
              aria-hidden={!breakdown}
              inert={!breakdown}
              className={cn(
                "-mt-4 grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:transition-none",
                breakdown ? "mt-0 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface-raised p-3">
                  <span className="overline px-2 pt-1 text-ink-muted">By token</span>
                  <ul className="m-0 flex list-none flex-col p-0">
                    {totals.map(([id, total]) => (
                      <li key={id} className="flex items-center gap-3 rounded-md px-2 py-2.5">
                        <TokenAvatar symbol={total.symbol} chainId={total.chainId} size={32} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-semibold tabular-nums">
                            {formatTokenAmount(total.amount.toString(), total.decimals)}{" "}
                            {total.symbol}
                          </span>
                          <span className="caption truncate text-ink-muted">
                            on {chainName(total.chainId)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-sm font-semibold text-ink-muted tabular-nums">
                          {total.value !== null ? formatReference(total.value) : "No price"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="caption m-0 px-2 pb-1 text-ink-muted">
                    Approximate, at today&apos;s prices. Prizes are always paid in their own token.
                    Unverified tokens are never priced.
                  </p>
                </section>
              </div>
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
                      className="grid gap-3 px-5 py-4 transition-colors hover:bg-surface-sunken md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_6rem] md:items-center md:gap-4"
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
                      <PrizeCell
                        amount={`${formatTokenAmount(item.prize, tokenDecimals(item))} ${tokenSymbol(item)}`}
                        value={valueOf(item)}
                      />
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

/** The prize in USDT when it can be priced, with the exact token amount under it. */
function PrizeCell({ amount, value }: { amount: string; value: number | null }) {
  if (value === null) {
    return (
      <span className="font-display font-extrabold text-lagoon tabular-nums md:text-right">
        {amount}
      </span>
    );
  }
  return (
    <span className="flex flex-col md:items-end">
      <span className="font-display font-extrabold text-lagoon tabular-nums">
        {formatReference(value)}
      </span>
      <span className="caption text-ink-muted tabular-nums">{amount}</span>
    </span>
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
