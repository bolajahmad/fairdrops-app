/**
 * Claiming prizes from the winner's own wallet. FairDrops usually relays claims for winners, so
 * this is for winners who want to claim themselves, or when relaying is off.
 */
import { fairDropsAbi } from "@fairdrops/contracts";
import type { Address, ClaimView, Hex } from "@fairdrops/shared";
import type { PublicClient, WalletClient } from "viem";
import { fairDropsChain, publicClientFor } from "./chain.js";

export interface ClaimOptions {
  publicClient?: PublicClient;
}

/**
 * Claims one prize with its Merkle proof (from `fd.claims.get`). Anyone may send it; the prize
 * always goes to the winner, or to their payout wallet.
 */
export async function claimPrize(
  wallet: WalletClient,
  claim: ClaimView,
  options: ClaimOptions = {},
): Promise<Hex> {
  if (!wallet.account) throw new Error("The wallet client has no account");
  if (claim.claimedAt) throw new Error("This prize was already claimed");
  const client = options.publicClient ?? publicClientFor(claim.chainId);
  const hash = await wallet.writeContract({
    account: wallet.account,
    chain: fairDropsChain(claim.chainId),
    address: claim.contract,
    abi: fairDropsAbi,
    functionName: "claim",
    args: [claim.giveawayId, claim.account, BigInt(claim.amount), claim.proof],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Claim ${hash} reverted`);
  return hash;
}

/** Whether the contract has recorded this account's claim. */
export async function isClaimed(
  claim: Pick<ClaimView, "chainId" | "contract" | "giveawayId" | "account">,
  options: ClaimOptions = {},
): Promise<boolean> {
  const client = options.publicClient ?? publicClientFor(claim.chainId);
  return client.readContract({
    address: claim.contract,
    abi: fairDropsAbi,
    functionName: "isClaimed",
    args: [claim.giveawayId, claim.account],
  });
}

/**
 * Sends future payouts for the calling account on this chain to another wallet, for example
 * when the winning account cannot receive the token.
 */
export async function setPayoutWallet(
  wallet: WalletClient,
  chainId: number,
  contract: Address,
  payTo: Address,
  options: ClaimOptions = {},
): Promise<Hex> {
  if (!wallet.account) throw new Error("The wallet client has no account");
  const client = options.publicClient ?? publicClientFor(chainId);
  const hash = await wallet.writeContract({
    account: wallet.account,
    chain: fairDropsChain(chainId),
    address: contract,
    abi: fairDropsAbi,
    functionName: "setPayoutWallet",
    args: [payTo],
  });
  await client.waitForTransactionReceipt({ hash });
  return hash;
}
