"use client";

import type { Address, RelayQuote } from "@fairdrops/shared";
import { useEffect, useState } from "react";
import { Button } from "./button";
import { ErrorNote } from "./error-note";
import { Field } from "./field";
import { Segmented } from "./segmented";
import { Sheet } from "./sheet";
import { friendlyError } from "@/lib/errors";
import { formatTokenAmount, shortenWallet } from "@/lib/format";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Moves funds out without gas: a prize to collect, a host's withdrawal, a send from the
 * FairDrops wallet. Shows the relayer's fee (taken from the amount, in the same token) and
 * where it goes before the wallet is asked to sign anything. Render it only while it's open.
 */
export function PayoutSheet({
  open,
  onOpenChange,
  title,
  amount,
  decimals,
  symbol,
  self,
  feeOnTop = false,
  loadQuote,
  confirmLabel,
  busyLabel,
  onConfirm,
  fallback,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  amount: bigint;
  decimals: number;
  symbol: string;
  /** The signed-in wallet: the default destination. */
  self: Address;
  /** The fee is paid on top of the amount (a send) instead of out of it. */
  feeOnTop?: boolean;
  loadQuote: () => Promise<RelayQuote>;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: (recipient: Address, quote: RelayQuote) => Promise<void>;
  /** Paying the gas yourself, offered if gas-free isn't available. */
  fallback?: { label: string; run: () => Promise<void> };
}) {
  const [quote, setQuote] = useState<RelayQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [to, setTo] = useState<"self" | "other">("self");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mounted only while open (see the callers), so this quotes once per opening.
  useEffect(() => {
    let live = true;
    loadQuote()
      .then((next) => live && setQuote(next))
      .catch((caught: unknown) => {
        if (live) setQuoteError(friendlyError(caught, "Couldn't work out the fee."));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fee = quote ? BigInt(quote.fee) : null;
  const received = fee === null ? null : feeOnTop ? amount : amount - fee;
  const recipient = (to === "self" ? self : other.toLowerCase()) as Address;
  const validOther = ADDRESS.test(other);
  const fmt = (value: bigint) => `${formatTokenAmount(value.toString(), decimals)} ${symbol}`;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onOpenChange(false);
    } catch (caught) {
      setError(friendlyError(caught, "That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)} title={title}>
      <dl className="m-0 flex flex-col gap-2 rounded-lg bg-surface-sunken p-4">
        <Line label="Amount" value={fmt(amount)} />
        <Line
          label={feeOnTop ? "Network fee, added" : "Network fee, taken from it"}
          value={fee === null ? (quoteError ? "Unavailable" : "Working it out…") : fmt(fee)}
          muted
        />
        <div className="my-1 border-t border-line" />
        <Line
          label={feeOnTop ? "Leaves your wallet" : "You receive"}
          value={received === null ? "…" : fmt(feeOnTop && fee !== null ? amount + fee : received)}
          strong
        />
      </dl>
      <p className="caption m-0 text-ink-muted">
        No gas needed: you only sign, and FairDrops sends it and pays the network for you.
      </p>

      <Segmented
        label="Send to"
        value={to}
        onChange={(value) => setTo(value as "self" | "other")}
        options={[
          { value: "self", label: `Your wallet ${shortenWallet(self)}` },
          { value: "other", label: "Another wallet" },
        ]}
      />
      {to === "other" ? (
        <Field
          label="Wallet address"
          placeholder="0x…"
          value={other}
          onChange={(event) => setOther(event.target.value.trim())}
          error={
            other && !validOther
              ? "That isn't a wallet address. It starts with 0x and has 42 characters."
              : undefined
          }
          hint="Check it carefully: what's sent can't be taken back."
        />
      ) : null}

      {quoteError ? <ErrorNote>{quoteError}</ErrorNote> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Button
        size="lg"
        block
        loading={busy}
        disabled={!quote || (to === "other" && !validOther)}
        onClick={() => void run(() => onConfirm(recipient, quote!))}
      >
        {busy ? busyLabel : confirmLabel}
      </Button>
      {quoteError && fallback && to === "self" ? (
        <Button variant="secondary" block disabled={busy} onClick={() => void run(fallback.run)}>
          {fallback.label}
        </Button>
      ) : null}
    </Sheet>
  );
}

function Line({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={muted ? "text-ink-muted" : "text-ink"}>{label}</dt>
      <dd className={`m-0 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
