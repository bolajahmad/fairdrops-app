"use client";

import {
  approvedTokens,
  referenceValue,
  toTokenView,
  type Address,
  type RelayQuote,
  type TokenView,
} from "@fairdrops/shared";
import { balancesOf } from "@fairdrops/sdk/host";
import { parseUnits } from "viem";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AccountChip } from "./account-chip";
import { Button } from "./button";
import { ErrorNote } from "./error-note";
import { Field } from "./field";
import { Shell } from "./shell";
import { Sheet } from "./sheet";
import { SignInPanel } from "./sign-in-panel";
import { TokenAvatar } from "./token-avatar";
import { useAccount } from "@/lib/account";
import { friendlyError } from "@/lib/errors";
import { gasFreeEnabled, quoteSend, sendGasFree } from "@/lib/gas-free";
import { formatReference, usePrices } from "@/lib/prices";
import { chainName, displayUnits, hostChains, tokenKey } from "@/lib/tokens";
import { onEmbeddedWalletChange, usingEmbeddedWallet } from "@/lib/wallet";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The tokens worth showing: FairDrops' approved ones on the networks it runs on. */
function walletTokens(): TokenView[] {
  const chains = new Set(hostChains().map((chain) => chain.chainId));
  return approvedTokens.filter((token) => chains.has(token.chainId)).map((t) => toTokenView(t));
}

function useEmbeddedReady(): boolean {
  return useSyncExternalStore(onEmbeddedWalletChange, usingEmbeddedWallet, () => false);
}

/**
 * The account's wallet: its address (to fund it), what it holds on each network, and, for the
 * FairDrops wallet of a social sign-in, sending funds out without gas.
 */
export function WalletScreen() {
  const account = useAccount();
  const prices = usePrices();
  const embeddedReady = useEmbeddedReady();
  const [balances, setBalances] = useState<Map<string, bigint> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<TokenView | null>(null);
  const [copied, setCopied] = useState(false);
  const me = account.state.status === "signedIn" ? account.state.me : null;
  const owner = me?.wallet ?? null;
  const embedded = me !== null && me.login.method !== "wallet";

  const load = useCallback(async (address: Address) => {
    try {
      setBalances(await balancesOf(address, walletTokens()));
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't read your balances."));
    }
  }, []);

  useEffect(() => {
    if (!owner) return;
    let live = true;
    balancesOf(owner, walletTokens())
      .then((found) => live && setBalances(found))
      .catch((caught: unknown) => {
        if (live) setError(friendlyError(caught, "Couldn't read your balances."));
      });
    return () => {
      live = false;
    };
  }, [owner]);

  const tokens = walletTokens();
  const held = (token: TokenView) => balances?.get(tokenKey(token)) ?? 0n;
  // What it holds first, then the rest by network.
  const sorted = [...tokens].sort(
    (a, b) => Number(held(b) > 0n) - Number(held(a) > 0n) || a.chainId - b.chainId,
  );

  return (
    <Shell>
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="display-l m-0">Wallet</h1>
          <p className="m-0 text-ink-muted">
            {embedded
              ? "Your FairDrops wallet: fund it to host, and send what's in it anywhere, no gas needed."
              : "What your wallet holds on the networks FairDrops runs on."}
          </p>
        </div>
        {me ? <AccountChip me={me} onSignOut={() => void account.signOut()} /> : null}
      </header>

      <div className="mt-10 flex w-full max-w-[760px] flex-col gap-8">
        {account.state.status === "signedOut" ? (
          <SignInPanel
            title="Sign in to see your wallet"
            reason="See what your wallet holds, add funds for hosting and send them anywhere."
            busy={account.busy}
            error={account.error}
            onWallet={() => void account.signInWithWallet()}
            onSocial={(provider) => void account.signInWithSocial(provider)}
          />
        ) : null}

        {owner ? (
          <section className="flex flex-col gap-3 rounded-xl bg-lagoon-soft p-6">
            <span className="overline text-lagoon-strong">
              {embedded ? "Your FairDrops wallet" : "Your wallet"}
            </span>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(owner)
                  .then(() => setCopied(true))
                  .catch(() => undefined)
              }
              className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2 text-left"
            >
              <span className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">{owner}</span>
              <span className="caption shrink-0 font-semibold text-lagoon">
                {copied ? "Copied" : "Copy"}
              </span>
            </button>
            <p className="caption m-0 text-lagoon-strong">
              {embedded
                ? `To add funds, send tokens to this address on ${hostChains()
                    .map((chain) => chain.name)
                    .join(", ")}. Hosting and sending from it are paid in the token itself.`
                : "Manage this wallet's funds in the wallet itself. Prizes you win are sent here."}
            </p>
          </section>
        ) : null}

        {owner ? (
          <section className="flex flex-col gap-3">
            <h2 className="title-m m-0">Balances</h2>
            {balances === null ? (
              <div className="flex flex-col gap-3" aria-busy>
                {[0, 1, 2].map((row) => (
                  <div key={row} className="h-16 animate-pulse rounded-lg bg-surface-sunken" />
                ))}
              </div>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {sorted.map((token) => {
                  const amount = held(token);
                  const value =
                    prices && amount > 0n
                      ? referenceValue(
                          { chainId: token.chainId, address: token.address },
                          amount.toString(),
                          token.decimals,
                          prices,
                        )
                      : null;
                  return (
                    <li
                      key={tokenKey(token)}
                      className="flex items-center gap-3 rounded-lg border border-line bg-surface-raised p-3"
                    >
                      <TokenAvatar symbol={token.symbol} chainId={token.chainId} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-semibold">{token.symbol}</span>
                        <span className="caption truncate text-ink-muted">
                          {chainName(token.chainId)}
                        </span>
                      </span>
                      <span className="flex flex-col items-end">
                        <span className="font-semibold tabular-nums">
                          {displayUnits(amount, token.decimals)}
                        </span>
                        {value !== null ? (
                          <span className="caption text-ink-muted tabular-nums">
                            {formatReference(value)}
                          </span>
                        ) : null}
                      </span>
                      {embedded && gasFreeEnabled() ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="send"
                          disabled={amount === 0n || !embeddedReady}
                          onClick={() => setSending(token)}
                        >
                          Send
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>

      {sending && owner ? (
        <SendSheet
          token={sending}
          owner={owner}
          balance={held(sending)}
          onClose={() => setSending(null)}
          onSent={() => void load(owner)}
        />
      ) : null}
    </Shell>
  );
}

/** Sends a token out of the FairDrops wallet. The fee is paid on top, in the same token. */
function SendSheet({
  token,
  owner,
  balance,
  onClose,
  onSent,
}: {
  token: TokenView;
  owner: Address;
  balance: bigint;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  // The quote and the amount it was for: a quote for an earlier amount isn't shown or signed.
  const [quoted, setQuoted] = useState<{ amount: bigint; quote: RelayQuote } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const amount = parseAmount(text, token.decimals);
  const quote = quoted && quoted.amount === amount ? quoted.quote : null;
  const fee = quote ? BigInt(quote.fee) : null;
  const total = amount !== null && fee !== null ? amount + fee : null;
  const short = total !== null && total > balance;
  const validTo = ADDRESS.test(to) && to.toLowerCase() !== owner;

  // A fresh quote for what's typed, after a pause: the fee depends on the amount.
  useEffect(() => {
    if (!amount) return;
    let live = true;
    const timer = setTimeout(() => {
      setQuoting(true);
      quoteSend({ chainId: token.chainId, account: owner, token: token.address, amount })
        .then((next) => live && setQuoted({ amount, quote: next }))
        .catch((caught: unknown) => {
          if (live) setError(friendlyError(caught, "Couldn't work out the fee."));
        })
        .finally(() => live && setQuoting(false));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [amount, owner, token]);

  async function max() {
    setError(null);
    try {
      const q = await quoteSend({
        chainId: token.chainId,
        account: owner,
        token: token.address,
        amount: balance,
      });
      const rest = balance - BigInt(q.fee);
      if (rest <= 0n) {
        setError("There isn't enough to cover the network fee.");
        return;
      }
      setText(trimUnits(rest, token.decimals));
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't work out the fee."));
    }
  }

  async function send() {
    if (!amount || !quote) return;
    setBusy(true);
    setError(null);
    try {
      await sendGasFree({
        chainId: token.chainId,
        token: token.address,
        to: to.toLowerCase() as Address,
        amount,
        quote,
      });
      setDone(true);
      onSent();
    } catch (caught) {
      setError(friendlyError(caught, "Nothing was sent. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const fmt = (value: bigint) => `${displayUnits(value, token.decimals, 6)} ${token.symbol}`;

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={done ? "Sent" : `Send ${token.symbol}`}
    >
      {done ? (
        <>
          <p className="m-0">
            {fmt(amount ?? 0n)} is on its way to{" "}
            <span className="font-mono text-sm">
              {to.slice(0, 6)}…{to.slice(-4)}
            </span>{" "}
            on {chainName(token.chainId)}.
          </p>
          <Button block onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <>
          <Field
            label="To"
            placeholder="0x…"
            value={to}
            onChange={(event) => setTo(event.target.value.trim())}
            error={
              to && !validTo
                ? to.toLowerCase() === owner
                  ? "That's this wallet."
                  : "That isn't a wallet address. It starts with 0x and has 42 characters."
                : undefined
            }
            hint={`An address on ${chainName(token.chainId)}. What's sent can't be taken back.`}
          />
          <Field
            label="Amount"
            inputMode="decimal"
            suffix={token.symbol}
            value={text}
            onChange={(event) => setText(event.target.value.replace(/[^0-9.]/g, ""))}
            hint={`You have ${fmt(balance)}.`}
          />
          <Button variant="ghost" size="sm" className="self-start" onClick={() => void max()}>
            Send everything
          </Button>
          <dl className="m-0 flex flex-col gap-2 rounded-lg bg-surface-sunken p-4">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Network fee</dt>
              <dd className="m-0 tabular-nums">
                {fee !== null ? fmt(fee) : quoting ? "Working it out…" : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Leaves your wallet</dt>
              <dd className="m-0 font-semibold tabular-nums">
                {total !== null ? fmt(total) : "—"}
              </dd>
            </div>
          </dl>
          <p className="caption m-0 text-ink-muted">
            No gas needed: you only sign, and FairDrops sends it and pays the network. The fee is
            paid in {token.symbol}.
          </p>
          {short ? (
            <ErrorNote>That&apos;s more than this wallet holds with the fee.</ErrorNote>
          ) : null}
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button
            size="lg"
            block
            icon="send"
            loading={busy}
            disabled={!validTo || !amount || !quote || short}
            onClick={() => void send()}
          >
            {busy ? "Sending" : "Send"}
          </Button>
        </>
      )}
    </Sheet>
  );
}

function parseAmount(text: string, decimals: number): bigint | null {
  if (!/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) return null;
  try {
    const value = parseUnits(text, decimals);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

/** Exact units for an input field, without trailing zeros. */
function trimUnits(value: bigint, decimals: number): string {
  const whole = value / 10n ** BigInt(decimals);
  const fraction = (value % 10n ** BigInt(decimals))
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
