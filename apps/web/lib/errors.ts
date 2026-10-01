import { findChain } from "@fairdrops/shared";

/** Turns anything thrown (viem, wallet, SDK, fetch) into one short sentence a person can act on. */
export function friendlyError(
  caught: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  const chain = errorChain(caught);
  const text = chain.map(messageOf).join("\n");
  const names = chain.map((error) => (error as { name?: string }).name ?? "");
  const codes = chain.map((error) => (error as { code?: unknown }).code);

  if (
    codes.includes(4001) ||
    /user (rejected|denied)|rejected the request|request rejected/i.test(text)
  ) {
    return "You cancelled in your wallet. Nothing was sent.";
  }
  const mismatch = /current chain of the wallet \(id: (\d+)\).*target chain .*\(id: (\d+)/is.exec(
    text,
  );
  if (names.includes("ChainMismatchError") || mismatch) {
    const from = chainName(mismatch?.[1]);
    const to = chainName(mismatch?.[2]);
    return `Your wallet is on ${from}, but this needs ${to}. Switch networks in your wallet and try again.`;
  }
  if (
    names.includes("InsufficientFundsError") ||
    /insufficient funds|exceeds (the )?balance/i.test(text)
  ) {
    return "Your wallet doesn't have enough to cover this and the network fee.";
  }
  if (/no wallet found/i.test(text)) {
    return "No wallet found in this browser. Install one, or use another way to sign in.";
  }
  if (codes.includes(-32002) || /already pending/i.test(text)) {
    return "Your wallet already has a request open. Finish it there first.";
  }
  if (
    /failed to fetch|networkerror|load failed|ECONNREFUSED|fetch failed/i.test(text) ||
    codes.includes("NETWORK")
  ) {
    return "We couldn't reach FairDrops. Check your connection and try again.";
  }
  const revert = /reverted with the following reason:\s*\n?\s*(.+)/i.exec(text)?.[1] ?? null;
  if (revert) return `The contract refused this: ${trimSentence(revert)}`;

  for (const error of chain) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof short === "string" && short.trim()) return trimSentence(short);
  }
  const first = chain.map(messageOf).find((message) => message.trim());
  return first ? trimSentence(first) : fallback;
}

function errorChain(caught: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = caught;
  while (current && chain.length < 8 && !chain.includes(current)) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function chainName(id: string | undefined): string {
  if (!id) return "another network";
  return findChain(Number(id))?.name ?? `network ${id}`;
}

/** First line, without viem's "Request Arguments", "Docs", "Version" tails, at most ~180 characters. */
function trimSentence(message: string): string {
  const line =
    message
      .split(/\n|Request Arguments:|Contract Call:|Docs:|Details:|Version:/)[0]
      ?.trim()
      .replace(/\s+/g, " ") ?? "";
  const clipped = line.length > 180 ? `${line.slice(0, 177).trimEnd()}…` : line;
  return /[.!?…]$/.test(clipped) ? clipped : `${clipped}.`;
}
