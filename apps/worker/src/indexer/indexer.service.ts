import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { ChainIndexer } from "./chain-indexer.js";
import { HttpSubgraphClient, SubgraphError, type SubgraphClient } from "./subgraph-client.js";
import { resolveTargets, type IndexTarget } from "./targets.js";

const MAX_BACKOFF_MS = 60_000;
/** How often a halted chain checks whether an operator has cleared it. */
const HALTED_RECHECK_MS = 60_000;

export const SUBGRAPH_CLIENT_FACTORY = Symbol("SUBGRAPH_CLIENT_FACTORY");
export type SubgraphClientFactory = (target: IndexTarget) => SubgraphClient;

/** Runs one sync loop per indexed chain for the lifetime of the worker. */
@Injectable()
export class IndexerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(IndexerService.name);
  private readonly abort = new AbortController();
  private readonly loops: Promise<void>[] = [];
  readonly indexers: ChainIndexer[];

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) db: Database,
    @Inject(SUBGRAPH_CLIENT_FACTORY) createClient: SubgraphClientFactory,
  ) {
    this.indexers = env.INDEXER_ENABLED
      ? resolveTargets(env).map(
          (target) => new ChainIndexer(target, createClient(target), db, env.INDEXER_BATCH_SIZE),
        )
      : [];
  }

  onApplicationBootstrap(): void {
    if (!this.env.INDEXER_ENABLED) {
      this.logger.log("Indexer disabled (INDEXER_ENABLED=false)");
      return;
    }
    if (this.indexers.length === 0) {
      this.logger.warn(`No indexable chains in ${this.env.DEPLOYMENT_ENVIRONMENT}`);
      return;
    }
    for (const indexer of this.indexers) {
      const { chain, contractAddress } = indexer.target;
      this.logger.log(`Indexing ${chain.key} (${chain.chainId}) FairDrops at ${contractAddress}`);
      this.loops.push(this.run(indexer));
    }
  }

  /** Stops polling and waits for in-flight batches, before the database disconnects. */
  async beforeApplicationShutdown(): Promise<void> {
    this.abort.abort();
    await Promise.allSettled(this.loops);
  }

  private async run(indexer: ChainIndexer): Promise<void> {
    const { signal } = this.abort;
    const name = indexer.target.chain.key;
    let failures = 0;
    let halted = false;

    while (!signal.aborted) {
      let delay = this.env.INDEXER_POLL_INTERVAL_MS;
      try {
        const outcome = await indexer.syncOnce();
        failures = 0;
        if (outcome.status === "halted") {
          if (!halted) this.logger.error(`${name}: sync halted. ${outcome.reason}`);
          halted = true;
          delay = HALTED_RECHECK_MS;
        } else {
          if (halted) this.logger.log(`${name}: sync resumed`);
          halted = false;
          if (outcome.status === "applied") {
            this.logger.log(
              `${name}: copied ${outcome.events} event(s), synced to block ${outcome.syncedBlock}`,
            );
            if (outcome.more) delay = 0;
          }
        }
      } catch (error) {
        failures += 1;
        delay = backoff(failures, error);
        this.logger.warn(
          `${name}: sync failed (attempt ${failures}), retrying in ${delay} ms: ${(error as Error).message}`,
        );
        await indexer.recordError(error).catch(() => undefined);
      }

      try {
        await sleep(delay, undefined, { signal });
      } catch {
        // Aborted: the loop condition ends it.
      }
    }
  }
}

export function createHttpSubgraphClient(env: WorkerEnv): SubgraphClientFactory {
  return (target) => new HttpSubgraphClient(target.endpoint, env.GOLDSKY_API_TOKEN);
}

/** Exponential backoff with jitter, honouring a rate limit's Retry-After. */
function backoff(failures: number, error: unknown): number {
  if (error instanceof SubgraphError && error.retryAfterSeconds) {
    return Math.min(error.retryAfterSeconds * 1000, MAX_BACKOFF_MS);
  }
  const base = Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
  return Math.round(base / 2 + Math.random() * (base / 2));
}
