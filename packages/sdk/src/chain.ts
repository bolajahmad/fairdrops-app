import { findDeployment } from "@fairdrops/contracts";
import { findChain, type Address } from "@fairdrops/shared";
import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";

/** A viem chain for a FairDrops registry chain, for wallet clients and public clients. */
export function fairDropsChain(chainId: number): Chain {
  const entry = findChain(chainId);
  if (!entry) throw new Error(`Chain ${chainId} is not supported by FairDrops`);
  return defineChain({
    id: entry.chainId,
    name: entry.name,
    nativeCurrency: entry.nativeCurrency,
    rpcUrls: { default: { http: [...entry.rpcUrls] } },
    blockExplorers: entry.blockExplorer
      ? { default: { name: entry.blockExplorer.name, url: entry.blockExplorer.url } }
      : undefined,
  });
}

/** A read-only client over the registry's public RPC, or `rpcUrl` if given. */
export function publicClientFor(chainId: number, rpcUrl?: string): PublicClient {
  return createPublicClient({ chain: fairDropsChain(chainId), transport: http(rpcUrl) });
}

/** The FairDrops contract on a chain, from the published deployments. */
export function fairDropsAddress(chainId: number): Address {
  const deployment = findDeployment(chainId);
  if (!deployment) throw new Error(`FairDrops is not deployed on chain ${chainId}`);
  return deployment.address;
}
