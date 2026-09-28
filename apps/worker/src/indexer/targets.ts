import { findDeployment } from "@fairdrops/contracts";
import {
  SUBGRAPH_TAG,
  chainsInEnvironment,
  subgraphName,
  type Address,
  type Chain,
} from "@fairdrops/shared";
import type { WorkerEnv } from "../config/env.js";

/** One FairDrops deployment the worker keeps in sync. */
export interface IndexTarget {
  chain: Chain;
  contractAddress: Address;
  /** GraphQL endpoint of the chain's FairDrops subgraph. */
  endpoint: string;
}

export function goldskySubgraphUrl(
  projectId: string,
  chain: Chain,
  visibility: "public" | "private",
): string {
  return `https://api.goldsky.com/api/${visibility}/${projectId}/subgraphs/${subgraphName(chain)}/${SUBGRAPH_TAG}/gn`;
}

/**
 * Every chain of the environment that has a FairDrops deployment and a subgraph, narrowed to
 * INDEXER_CHAIN_IDS when set. Chains Goldsky cannot index are skipped.
 */
export function resolveTargets(env: WorkerEnv): IndexTarget[] {
  const candidates = chainsInEnvironment(env.DEPLOYMENT_ENVIRONMENT).filter(
    (chain) => chain.subgraphNetwork !== null && findDeployment(chain.chainId) !== undefined,
  );

  for (const chainId of env.INDEXER_CHAIN_IDS) {
    if (!candidates.some((chain) => chain.chainId === chainId)) {
      throw new Error(
        `INDEXER_CHAIN_IDS includes ${chainId}, which is not an indexable ${env.DEPLOYMENT_ENVIRONMENT} chain`,
      );
    }
  }
  const selected =
    env.INDEXER_CHAIN_IDS.length > 0
      ? candidates.filter((chain) => env.INDEXER_CHAIN_IDS.includes(chain.chainId))
      : candidates;

  return selected.map((chain) => {
    const endpoint =
      env.SUBGRAPH_ENDPOINTS.get(chain.chainId) ??
      (env.GOLDSKY_PROJECT_ID
        ? goldskySubgraphUrl(
            env.GOLDSKY_PROJECT_ID,
            chain,
            env.GOLDSKY_API_TOKEN ? "private" : "public",
          )
        : undefined);
    if (!endpoint) {
      throw new Error(
        `No subgraph endpoint for ${chain.key}: set GOLDSKY_PROJECT_ID, or ${chain.chainId}=<url> in SUBGRAPH_ENDPOINTS`,
      );
    }
    return {
      chain,
      contractAddress: findDeployment(chain.chainId)!.address,
      endpoint,
    };
  });
}
