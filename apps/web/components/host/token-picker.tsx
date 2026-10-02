"use client";

import type { Address, TokenView } from "@fairdrops/shared";
import { balancesOf } from "@fairdrops/sdk/host";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { ErrorNote } from "@/components/error-note";
import { Icon } from "@/components/icon";
import { Sheet } from "@/components/sheet";
import { TokenAvatar } from "@/components/token-avatar";
import { TrustBadge } from "@/components/trust-badge";
import { cn } from "@/lib/cn";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import { chainName, displayUnits, hostChains, tokenKey } from "@/lib/tokens";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Pick any ERC-20 on a hostable network: tokens you hold first (with balances), then search by
 * symbol or name, or paste a contract address. Whatever is picked carries its chain, symbol and
 * decimals from here on.
 */
export function TokenPicker({
  open,
  onOpenChange,
  selected,
  owner,
  onConnect,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: TokenView;
  owner: Address | null;
  onConnect: () => void;
  onSelect: (token: TokenView) => void;
}) {
  const [query, setQuery] = useState("");
  const [chainId, setChainId] = useState<number | undefined>(undefined);
  const [results, setResults] = useState<TokenView[] | null>(null);
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const chains = hostChains();
  const pasted = ADDRESS.test(query.trim());

  useEffect(() => {
    if (!open) return;
    let live = true;
    const q = query.trim();
    const timer = window.setTimeout(
      () => {
        browserFairDrops()
          .tokens.search({ q: q || undefined, chainId, limit: 50 })
          .then((found) => {
            if (!live) return;
            setResults(found);
            setError(null);
          })
          .catch((caught: unknown) => {
            if (!live) return;
            setResults([]);
            setError(friendlyError(caught, "Couldn't search tokens."));
          });
      },
      q ? 300 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open, query, chainId]);

  useEffect(() => {
    if (!owner || !results?.length) return;
    let live = true;
    balancesOf(owner, results)
      .then((found) => live && setBalances((current) => new Map([...current, ...found])))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [owner, results]);

  const list = results ?? [];
  const held = owner ? list.filter((token) => (balances.get(tokenKey(token)) ?? 0n) > 0n) : [];
  const rest = list.filter((token) => !held.includes(token));

  const row = (token: TokenView) => {
    const balance = balances.get(tokenKey(token));
    const on = tokenKey(token) === tokenKey(selected);
    return (
      <li key={tokenKey(token)}>
        <button
          type="button"
          onClick={() => {
            onSelect(token);
            onOpenChange(false);
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
            on ? "bg-lagoon-soft" : "hover:bg-surface-sunken",
          )}
        >
          <TokenAvatar symbol={token.symbol} chainId={token.chainId} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold">{token.symbol}</span>
              <TrustBadge trust={token.trust} />
            </span>
            <span className="caption truncate text-ink-muted">
              {token.name} · {chainName(token.chainId)}
            </span>
          </span>
          <span className="shrink-0 text-right font-mono text-sm tabular-nums">
            {balance !== undefined ? displayUnits(balance, token.decimals) : owner ? "0" : ""}
          </span>
        </button>
      </li>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Choose the prize token">
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 focus-within:border-focus">
        <Icon name="search" size={18} className="text-ink-muted" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, symbol or contract address"
          aria-label="Search tokens"
          className="min-h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => setQuery("")}
            className="text-ink-muted"
          >
            <Icon name="x" size={18} />
          </button>
        ) : null}
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {[{ chainId: undefined, name: "All networks" }, ...chains].map((chain) => (
          <button
            key={chain.chainId ?? "all"}
            type="button"
            onClick={() => setChainId(chain.chainId)}
            className={cn(
              "min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold whitespace-nowrap",
              chainId === chain.chainId
                ? "bg-ink text-surface"
                : "border border-line bg-surface-raised text-ink-muted",
            )}
          >
            {chain.name}
          </button>
        ))}
      </div>

      {!owner ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-sunken px-4 py-3">
          <span className="caption text-ink-muted">
            Connect your wallet to see the tokens you hold.
          </span>
          <Button size="sm" variant="secondary" icon="wallet" onClick={onConnect}>
            Connect
          </Button>
        </div>
      ) : null}

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {results === null ? (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-14 animate-pulse rounded-md bg-surface-sunken" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {held.length ? (
            <section className="flex flex-col gap-1">
              <span className="overline px-3 text-ink-muted">Your tokens</span>
              <ul className="m-0 flex list-none flex-col p-0">{held.map(row)}</ul>
            </section>
          ) : null}
          {rest.length ? (
            <section className="flex flex-col gap-1">
              <span className="overline px-3 text-ink-muted">
                {pasted ? "Found at that address" : query ? "Matches" : "All tokens"}
              </span>
              <ul className="m-0 flex list-none flex-col p-0">{rest.map(row)}</ul>
            </section>
          ) : null}
          {!list.length ? (
            <p className="m-0 rounded-md border border-dashed border-line-strong p-4 text-ink-muted">
              {pasted
                ? "No ERC-20 token at that address on the networks FairDrops runs on."
                : "No token matches. Paste the token's contract address to use any ERC-20."}
            </p>
          ) : (
            <p className="caption m-0 px-3 text-ink-muted">
              Don&apos;t see your token? Paste its contract address above.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
