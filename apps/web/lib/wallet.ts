"use client";

import { findChain } from "@fairdrops/shared";
import { fairDropsChain } from "@fairdrops/sdk/host";
import { createWalletClient, custom, numberToHex, type Address, type WalletClient } from "viem";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/** EIP-3085: the wallet does not know the chain yet. */
const UNKNOWN_CHAIN = 4902;

function injected(): EthereumProvider {
  const ethereum = (globalThis as { ethereum?: EthereumProvider }).ethereum;
  if (!ethereum) throw new Error("No wallet found in this browser.");
  return ethereum;
}

/**
 * Puts the wallet on `chainId` before anything is signed: asks it to switch, and if it has never
 * seen the chain, offers to add it from the registry. Without this, a wallet left on another
 * network fails every transaction with a chain-mismatch error.
 */
async function ensureChain(ethereum: EthereumProvider, chainId: number): Promise<void> {
  const current = Number(await ethereum.request({ method: "eth_chainId" }));
  if (current === chainId) return;
  const hex = numberToHex(chainId);
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (caught) {
    if ((caught as { code?: number }).code !== UNKNOWN_CHAIN) throw caught;
    const chain = findChain(chainId);
    if (!chain) throw new Error(`FairDrops does not support chain ${chainId}.`);
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: chain.blockExplorer ? [chain.blockExplorer.url] : undefined,
        },
      ],
    });
  }
}

export async function connectInjectedWallet(chainId: number): Promise<WalletClient> {
  const ethereum = injected();
  const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as Address[];
  const account = accounts[0];
  if (!account) throw new Error("The wallet did not share an account.");
  await ensureChain(ethereum, chainId);
  return createWalletClient({
    account,
    chain: fairDropsChain(chainId),
    transport: custom(ethereum),
  });
}
