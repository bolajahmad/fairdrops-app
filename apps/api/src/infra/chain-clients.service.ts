import { Injectable } from "@nestjs/common";
import { findChain } from "@fairdrops/shared";
import { createPublicClient, defineChain, http, type PublicClient } from "viem";

const RPC_TIMEOUT_MS = 5_000;

/** One viem client per registry chain, created on first use. */
@Injectable()
export class ChainClients {
  private readonly clients = new Map<number, PublicClient>();

  get(chainId: number): PublicClient {
    const existing = this.clients.get(chainId);
    if (existing) return existing;

    const chain = findChain(chainId);
    if (!chain) throw new Error(`Chain ${chainId} is not in the registry`);

    const client = createPublicClient({
      chain: defineChain({
        id: chain.chainId,
        name: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: { default: { http: chain.rpcUrls } },
      }),
      transport: http(chain.rpcUrls[0], { timeout: RPC_TIMEOUT_MS, retryCount: 1 }),
    });
    this.clients.set(chainId, client);
    return client;
  }
}
