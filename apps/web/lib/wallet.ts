"use client";

import { findChain } from "@fairdrops/shared";
import { fairDropsChain } from "@fairdrops/sdk/host";
import { createWalletClient, custom, numberToHex, type Address, type WalletClient } from "viem";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: "chainChanged", listener: (chainId: string) => void) => void;
  removeListener?: (event: "chainChanged", listener: (chainId: string) => void) => void;
}

/** The wallet would not move to the network an action needs. Carries the network's name. */
export class ChainSwitchError extends Error {
  constructor(
    readonly chainId: number,
    readonly chainName: string,
    readonly declined: boolean,
  ) {
    super(
      declined
        ? `Your wallet needs to be on ${chainName} to do this. Approve the network switch, then try again.`
        : `Your wallet couldn't switch to ${chainName}. Switch it there yourself, then try again.`,
    );
    this.name = "ChainSwitchError";
  }
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
  const chain = findChain(chainId);
  if (!chain) throw new Error(`FairDrops does not support chain ${chainId}.`);
  const hex = numberToHex(chainId);
  try {
    await switchOrAdd(ethereum, chain, hex);
  } catch (caught) {
    throw new ChainSwitchError(chainId, chain.name, (caught as { code?: number }).code === 4001);
  }
  // Some wallets resolve before they have actually moved; trust what they report next.
  const after = Number(await ethereum.request({ method: "eth_chainId" }));
  if (after !== chainId) throw new ChainSwitchError(chainId, chain.name, false);
}

async function switchOrAdd(
  ethereum: EthereumProvider,
  chain: NonNullable<ReturnType<typeof findChain>>,
  hex: string,
): Promise<void> {
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (caught) {
    if ((caught as { code?: number }).code !== UNKNOWN_CHAIN) throw caught;
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

/** The network the wallet is on now, or null without a wallet. Never prompts. */
export async function walletChainId(): Promise<number | null> {
  const ethereum = (globalThis as { ethereum?: EthereumProvider }).ethereum;
  if (!ethereum) return null;
  const id = await ethereum.request({ method: "eth_chainId" }).catch(() => null);
  return id === null ? null : Number(id);
}

/** Calls `listener` whenever the user (or a switch) moves the wallet to another network. */
export function onWalletChainChange(listener: (chainId: number) => void): () => void {
  const ethereum = (globalThis as { ethereum?: EthereumProvider }).ethereum;
  if (!ethereum?.on) return () => {};
  const handler = (id: string) => listener(Number(id));
  ethereum.on("chainChanged", handler);
  return () => ethereum.removeListener?.("chainChanged", handler);
}

/** The wallet's account if the site is already connected, without prompting. */
export async function connectedAccount(): Promise<Address | null> {
  const ethereum = (globalThis as { ethereum?: EthereumProvider }).ethereum;
  if (!ethereum) return null;
  const accounts = (await ethereum
    .request({ method: "eth_accounts" })
    .catch(() => [])) as Address[];
  return accounts[0] ?? null;
}

/** Asks the wallet for an account (a connect prompt), without switching networks or signing. */
export async function requestAccount(): Promise<Address> {
  const accounts = (await injected().request({ method: "eth_requestAccounts" })) as Address[];
  const account = accounts[0];
  if (!account) throw new Error("The wallet did not share an account.");
  return account;
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
