"use client";

import type { Address, ClaimView, Hex, RelayQuote } from "@fairdrops/shared";
import type { PreparedGiveaway } from "@fairdrops/sdk/host";
import {
  addFundsFromWallet,
  cancelFromWallet,
  collectPrize,
  hostFromWallet,
  sendFromWallet,
  setPayoutWalletGasFree,
  withdrawGasFree,
} from "@fairdrops/sdk/relay";
import { browserFairDrops, claimRelayEnabled } from "./fairdrops";
import { connectWallet, signAuthorization, usingEmbeddedWallet } from "./wallet";

/**
 * Gas-free actions: the wallet signs, FairDrops' relayer sends the transaction and pays the
 * gas, and keeps a small fee in the token being moved. Any wallet can collect a prize, withdraw
 * or set a payout wallet this way. Embedded wallets (social sign-in), which never hold the
 * network's coin, also host, manage and send their funds this way.
 */
export function gasFreeEnabled(): boolean {
  return claimRelayEnabled();
}

/** The fee for collecting a prize, to show before anyone signs. */
export function quoteCollect(claim: ClaimView): Promise<RelayQuote> {
  return browserFairDrops().relay.quote({
    chainId: claim.chainId,
    action: "claim",
    account: claim.account,
    token: claim.token,
    amount: claim.amount,
  });
}

export async function collectGasFree(
  claim: ClaimView,
  options: { recipient?: Address; quote?: RelayQuote } = {},
): Promise<void> {
  const wallet = await connectWallet(claim.chainId);
  await collectPrize(browserFairDrops(), wallet, {
    chainId: claim.chainId,
    giveawayId: claim.giveawayId,
    amount: BigInt(claim.amount),
    token: claim.token,
    ...options,
  });
}

/** The fee for a host's withdrawal of `owed`. */
export function quoteWithdraw(input: {
  chainId: number;
  host: Address;
  token: Address;
  owed: bigint;
}): Promise<RelayQuote> {
  return browserFairDrops().relay.quote({
    chainId: input.chainId,
    action: "withdraw",
    account: input.host,
    token: input.token,
    amount: input.owed.toString(),
  });
}

export async function withdrawToWallet(input: {
  chainId: number;
  giveawayId: Hex;
  token: Address;
  owed: bigint;
  recipient?: Address;
  quote?: RelayQuote;
}): Promise<void> {
  const wallet = await connectWallet(input.chainId);
  await withdrawGasFree(browserFairDrops(), wallet, input);
}

/** Free: no fee, the relayer pays the small gas. */
export async function setPayoutGasFree(chainId: number, destination: Address): Promise<void> {
  const wallet = await connectWallet(chainId);
  await setPayoutWalletGasFree(browserFairDrops(), wallet, { chainId, destination });
}

/** Whether hosting and managing go through the relayer: only embedded wallets need to. */
export function hostsGasFree(): boolean {
  return gasFreeEnabled() && usingEmbeddedWallet();
}

export async function hostGasFree(
  prepared: PreparedGiveaway,
  progress: { onSigning?: () => void; onSubmitted?: () => void } = {},
): Promise<{ giveawayId: Hex; fee: bigint }> {
  const wallet = await connectWallet(prepared.chainId);
  return hostFromWallet(browserFairDrops(), wallet, prepared, {
    ...progress,
    signAuthorization: signAuthorization(),
  });
}

export async function cancelGasFree(input: {
  chainId: number;
  giveawayId: Hex;
  token: Address;
  prize: bigint;
}): Promise<void> {
  const wallet = await connectWallet(input.chainId);
  await cancelFromWallet(browserFairDrops(), wallet, {
    ...input,
    signAuthorization: signAuthorization(),
  });
}

export async function addFundsGasFree(input: {
  chainId: number;
  giveawayId: Hex;
  token: Address;
  amount: bigint;
}): Promise<void> {
  const wallet = await connectWallet(input.chainId);
  await addFundsFromWallet(browserFairDrops(), wallet, {
    ...input,
    signAuthorization: signAuthorization(),
  });
}

/** The fee for sending `amount` of a token out of the embedded wallet. */
export function quoteSend(input: {
  chainId: number;
  account: Address;
  token: Address;
  amount: bigint;
}): Promise<RelayQuote> {
  return browserFairDrops().relay.quote({
    chainId: input.chainId,
    action: "execute",
    purpose: "send",
    account: input.account,
    token: input.token,
    amount: input.amount.toString(),
  });
}

export async function sendGasFree(input: {
  chainId: number;
  token: Address;
  to: Address;
  amount: bigint;
  quote?: RelayQuote;
}): Promise<void> {
  const wallet = await connectWallet(input.chainId);
  await sendFromWallet(browserFairDrops(), wallet, {
    ...input,
    signAuthorization: signAuthorization(),
  });
}
