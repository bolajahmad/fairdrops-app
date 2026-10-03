"use client";

import { findChain, referenceValue, type ClaimView } from "@fairdrops/shared";
import { claimPrize, setPayoutWallet } from "@fairdrops/sdk/claims";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { ErrorNote } from "@/components/error-note";
import { Field } from "@/components/field";
import { Icon } from "@/components/icon";
import { PrizeAmount } from "@/components/prize-amount";
import { Segmented } from "@/components/segmented";
import { Shell } from "@/components/shell";
import { SignInPanel } from "@/components/sign-in-panel";
import { StatusChip } from "@/components/status-chip";
import { ValueBreakdown, ValueSummary } from "@/components/value-total";
import { formatReference, totalsByToken, usePrices } from "@/lib/prices";
import { useAccount } from "@/lib/account";
import { AccountChip } from "@/components/account-chip";
import { copy } from "@/lib/copy";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import {
  formatTokenAmount,
  formatWhen,
  shortenWallet,
  tokenDecimals,
  tokenSymbol,
} from "@/lib/format";
import { connectWallet } from "@/lib/wallet";
import { collectGasFree, gasFreeEnabled, quoteCollect, setPayoutGasFree } from "@/lib/gas-free";
import { PayoutSheet } from "@/components/payout-sheet";

type Filter = "all" | "collect" | "collected";

const keyOf = (claim: ClaimView) => `${claim.chainId}:${claim.giveawayId}`;

export function PrizesScreen() {
  const account = useAccount();
  const [claims, setClaims] = useState<ClaimView[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [collecting, setCollecting] = useState<string | null>(null);
  // The prize whose gas-free collect sheet is open.
  const [sheetFor, setSheetFor] = useState<ClaimView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState(false);
  const prices = usePrices();
  const signedIn = account.state.status === "signedIn";

  const apply = useCallback((result: { claims: ClaimView[]; titles: Record<string, string> }) => {
    setClaims(result.claims);
    setTitles(result.titles);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await fetchClaims());
    } catch (caught) {
      setClaims([]);
      setError(friendlyError(caught, "Couldn't load your prizes."));
    }
  }, [apply]);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchClaims()
      .then((result) => {
        if (live) apply(result);
      })
      .catch((caught: unknown) => {
        if (!live) return;
        setClaims([]);
        setError(friendlyError(caught, "Couldn't load your prizes."));
      });
    return () => {
      live = false;
    };
  }, [signedIn, apply]);

  /** Collects paying the gas from the winner's own wallet. */
  async function collectYourself(claim: ClaimView) {
    const wallet = await connectWallet(claim.chainId);
    await claimPrize(wallet, claim);
    await load();
  }

  async function collect(claim: ClaimView) {
    if (gasFreeEnabled()) {
      setSheetFor(claim);
      return;
    }
    setCollecting(keyOf(claim));
    setError(null);
    try {
      await collectYourself(claim);
    } catch (caught) {
      setError(friendlyError(caught, "The prize wasn't collected. Try again."));
    } finally {
      setCollecting(null);
    }
  }

  const list = claims ?? [];
  const toCollect = list.filter((claim) => claim.claimable && !claim.claimedAt);
  const shown = list.filter((claim) =>
    filter === "collect"
      ? claim.claimable && !claim.claimedAt
      : filter === "collected"
        ? Boolean(claim.claimedAt)
        : true,
  );
  // Per token, not per symbol: USDC on two networks are two different tokens.
  const totals = totalsByToken(
    list.map((claim) => ({
      chainId: claim.chainId,
      address: claim.token,
      amount: claim.amount,
      decimals: tokenDecimals(claim),
      symbol: tokenSymbol(claim),
    })),
    prices,
  );

  return (
    <Shell>
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="display-l m-0">My prizes</h1>
          <p className="m-0 text-ink-muted">
            Everything you&apos;ve won, and what&apos;s left to collect.
          </p>
        </div>
        {account.state.status === "signedIn" ? (
          <AccountChip me={account.state.me} onSignOut={() => void account.signOut()} />
        ) : null}
      </header>

      <div className="mt-10 flex w-full max-w-[760px] flex-col gap-8">
        {account.state.status === "signedOut" ? (
          <SignInPanel
            title={copy.signIn.prizesTitle}
            reason={copy.signIn.prizesReason}
            busy={account.busy}
            error={account.error}
            onWallet={() => void account.signInWithWallet()}
            onSocial={(provider) => void account.signInWithSocial(provider)}
          />
        ) : null}

        {account.state.status === "loading" || (signedIn && claims === null) ? (
          <div className="flex flex-col gap-3" aria-busy>
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-20 animate-pulse rounded-lg bg-surface-sunken" />
            ))}
          </div>
        ) : null}

        {signedIn && claims !== null && list.length === 0 ? (
          <EmptyState
            icon="gift"
            title="No prizes yet"
            action={
              <Link href="/">
                <Button>Find a giveaway</Button>
              </Link>
            }
          >
            Play in a giveaway and anything you win shows up here.
          </EmptyState>
        ) : null}

        {signedIn && list.length > 0 ? (
          <>
            <section className="flex flex-col gap-4 rounded-xl bg-lagoon-soft p-6">
              <span className="overline text-lagoon-strong">Won so far</span>
              <div className="flex flex-col gap-1">
                <ValueSummary
                  totals={totals}
                  open={breakdown}
                  onToggle={() => setBreakdown((open) => !open)}
                  panelId="won-breakdown"
                  tone="onLagoon"
                />
              </div>
              <p className="m-0 text-lagoon-strong">
                {list.length} {list.length === 1 ? "prize" : "prizes"}
                {toCollect.length ? ` · ${toCollect.length} to collect` : " · all collected"}
              </p>
            </section>
            <ValueBreakdown
              totals={totals}
              open={breakdown}
              id="won-breakdown"
              className={breakdown ? "-mt-4" : "-mt-12"}
            />

            <section className="flex flex-col gap-4">
              <Segmented
                label="Show"
                value={filter}
                onChange={(value) => setFilter(value as Filter)}
                options={[
                  { value: "all", label: "All" },
                  { value: "collect", label: `To collect (${toCollect.length})` },
                  { value: "collected", label: "Collected" },
                ]}
              />
              {shown.length ? (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {shown.map((claim) => (
                    <PrizeRow
                      key={keyOf(claim)}
                      claim={claim}
                      value={
                        prices
                          ? referenceValue(
                              { chainId: claim.chainId, address: claim.token },
                              claim.amount,
                              tokenDecimals(claim),
                              prices,
                            )
                          : null
                      }
                      title={titles[keyOf(claim)] ?? "Giveaway"}
                      busy={collecting === keyOf(claim)}
                      onCollect={() => void collect(claim)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="m-0 rounded-lg border border-dashed border-line-strong p-4 text-ink-muted">
                  Nothing here.
                </p>
              )}
            </section>

            <PayoutCard claim={list[0]!} onError={setError} />
          </>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>
      {sheetFor ? (
        <PayoutSheet
          open
          onOpenChange={(open) => !open && setSheetFor(null)}
          title="Collect your prize"
          amount={BigInt(sheetFor.amount)}
          decimals={tokenDecimals(sheetFor)}
          symbol={tokenSymbol(sheetFor)}
          self={sheetFor.recipient}
          loadQuote={() => quoteCollect(sheetFor)}
          confirmLabel={copy.collect}
          busyLabel={copy.collecting}
          onConfirm={async (recipient, quote) => {
            await collectGasFree(sheetFor, { recipient, quote });
            await load();
          }}
          fallback={{
            label: "Pay the network fee yourself",
            run: () => collectYourself(sheetFor),
          }}
        />
      ) : null}
    </Shell>
  );
}

/** The signed-in player's prizes, with each giveaway's title (best effort). */
async function fetchClaims(): Promise<{ claims: ClaimView[]; titles: Record<string, string> }> {
  const fd = browserFairDrops();
  const claims = await fd.claims.mine();
  const named = await Promise.all(
    claims.map((claim) =>
      fd.giveaways
        .get(claim.chainId, claim.giveawayId)
        .then((giveaway) => [keyOf(claim), giveaway.metadata?.title ?? "Giveaway"] as const)
        .catch(() => [keyOf(claim), "Giveaway"] as const),
    ),
  );
  return { claims, titles: Object.fromEntries(named) };
}

function PrizeRow({
  claim,
  value,
  title,
  busy,
  onCollect,
}: {
  claim: ClaimView;
  /** Approximate USDT, or null when the token has no price. */
  value: number | null;
  title: string;
  busy: boolean;
  onCollect: () => void;
}) {
  const ready = claim.claimable && !claim.claimedAt;
  const chain = findChain(claim.chainId)?.name ?? `Chain ${claim.chainId}`;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4 sm:flex-row sm:items-center">
      <span className="grid size-11 shrink-0 place-items-center rounded-md bg-lagoon-soft text-lagoon-strong">
        <Icon name="gift" />
      </span>
      <Link
        href={`/g/${claim.chainId}/${claim.giveawayId}`}
        className="flex min-w-0 flex-1 flex-col no-underline"
      >
        <span className="truncate font-semibold text-ink">{title}</span>
        <span className="caption truncate text-ink-muted">
          {chain}
          {ready && claim.claimDeadline ? ` · collect by ${formatWhen(claim.claimDeadline)}` : ""}
        </span>
      </Link>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="flex flex-col sm:items-end">
          <PrizeAmount
            amount={formatTokenAmount(claim.amount, tokenDecimals(claim))}
            symbol={tokenSymbol(claim)}
            size="m"
          />
          {value !== null ? (
            <span className="caption text-ink-muted tabular-nums">{formatReference(value)}</span>
          ) : null}
        </span>
        {ready ? (
          <Button size="sm" icon="gift" loading={busy} onClick={onCollect}>
            {busy ? copy.collecting : copy.collect}
          </Button>
        ) : (
          <StatusChip status={claim.claimedAt ? "claimed" : "results"} />
        )}
      </div>
    </li>
  );
}

function PayoutCard({
  claim,
  onError,
}: {
  claim: ClaimView;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [payTo, setPayTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [recipient, setRecipient] = useState(claim.recipient);
  const chain = findChain(claim.chainId)?.name ?? `Chain ${claim.chainId}`;
  const valid = /^0x[0-9a-fA-F]{40}$/.test(payTo);

  async function save() {
    setSaving(true);
    onError(null);
    try {
      if (gasFreeEnabled()) {
        await setPayoutGasFree(claim.chainId, payTo as `0x${string}`);
      } else {
        const wallet = await connectWallet(claim.chainId);
        await setPayoutWallet(wallet, claim.chainId, claim.contract, payTo as `0x${string}`);
      }
      setRecipient(payTo.toLowerCase() as `0x${string}`);
      setEditing(false);
    } catch (caught) {
      onError(friendlyError(caught, "Couldn't change where prizes go."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="title-m m-0">Where prizes go</h2>
          <p className="m-0 text-ink-muted">
            Prizes on {chain} are sent to{" "}
            <span className="font-mono text-sm text-ink">{shortenWallet(recipient)}</span>.
          </p>
        </div>
        {editing ? null : (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <Field
            label="Send future prizes to"
            placeholder="0x…"
            value={payTo}
            onChange={(event) => setPayTo(event.target.value.trim())}
            error={
              payTo && !valid
                ? "That isn't a wallet address. It starts with 0x and has 42 characters."
                : undefined
            }
          />
          <div className="flex flex-wrap gap-3">
            <Button loading={saving} disabled={!valid} onClick={() => void save()}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
