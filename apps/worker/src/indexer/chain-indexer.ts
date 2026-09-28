import { Prisma, UNIQUE_VIOLATION, type ChainSync } from "@fairdrops/db";
import type { Database } from "../infra/prisma.module.js";
import { EVENT_ID_ZERO, MalformedEventError, toEvent, type FairDropsEvent } from "./events.js";
import { ProjectionError, applyEvent, type ProjectionTarget } from "./projector.js";
import type { EventBatch, SubgraphClient, SubgraphMeta } from "./subgraph-client.js";
import type { IndexTarget } from "./targets.js";

export type SyncOutcome =
  /** Copied `events` events. `more` means the batch was full and the next one can follow now. */
  | { status: "applied"; events: number; syncedBlock: bigint; more: boolean }
  /** Nothing new beyond the confirmation depth. */
  | { status: "idle"; syncedBlock: bigint }
  /** Another worker holds this chain or moved the cursor first; this batch was discarded. */
  | { status: "busy" }
  /** Syncing is stopped until an operator clears `halted_at`. */
  | { status: "halted"; reason: string };

class LostRace extends Error {}

/**
 * Copies one chain's FairDrops events from its subgraph into Postgres.
 *
 * Each call copies at most one batch, in a single transaction that applies the events and
 * advances the cursor together, so every event is applied exactly once however often the
 * worker crashes or restarts. Only events at least `confirmations` blocks deep are copied.
 */
export class ChainIndexer {
  private readonly key: ProjectionTarget;

  constructor(
    readonly target: IndexTarget,
    private readonly client: SubgraphClient,
    private readonly db: Database,
    private readonly batchSize: number,
  ) {
    this.key = { chainId: target.chain.chainId, contractAddress: target.contractAddress };
  }

  async syncOnce(): Promise<SyncOutcome> {
    const state = await this.db.chainSync.upsert({
      where: { chainId_contractAddress: this.key },
      create: this.key,
      update: {},
    });
    if (state.haltedAt) return { status: "halted", reason: state.lastError ?? "halted" };

    const head = await this.client.meta();
    const safeBlock = head.block - BigInt(this.target.chain.confirmations);
    if (safeBlock <= state.syncedBlock) {
      await this.recordMeta(head);
      return { status: "idle", syncedBlock: state.syncedBlock };
    }

    const batch = await this.client.events({
      after: state.cursor,
      maxBlock: safeBlock,
      first: this.batchSize,
    });

    if (state.cursorBlockHash !== null && batch.anchorBlockHash !== state.cursorBlockHash) {
      return this.halt(
        `Event ${state.cursor} was copied from block ${state.cursorBlockHash}, but the subgraph ` +
          `now has ${batch.anchorBlockHash ?? "no such event"}. A reorg went deeper than ` +
          `${this.target.chain.confirmations} confirmations; resync this chain.`,
      );
    }

    try {
      const events = batch.events.map(toEvent);
      return await this.commit(state, batch, events, safeBlock);
    } catch (error) {
      if (error instanceof LostRace) return { status: "busy" };
      const reason = permanentFailure(error);
      if (reason) return this.halt(reason);
      throw error;
    }
  }

  /** Records a transient failure so it is visible in the sync state. */
  async recordError(error: unknown): Promise<void> {
    await this.db.chainSync.updateMany({
      where: this.key,
      data: { lastError: describe(error), lastErrorAt: new Date() },
    });
  }

  private async commit(
    state: ChainSync,
    batch: EventBatch,
    events: FairDropsEvent[],
    safeBlock: bigint,
  ): Promise<SyncOutcome> {
    const last = events.at(-1);
    const more = events.length === this.batchSize;
    // A full batch may stop part way through the last event's block. Otherwise everything up
    // to the block the subgraph answered at (which can trail the head it reported) is copied.
    const covered = more
      ? last!.blockNumber - 1n
      : batch.meta.block < safeBlock
        ? batch.meta.block
        : safeBlock;
    const syncedBlock = covered > state.syncedBlock ? covered : state.syncedBlock;

    await this.db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(
            hashtextextended(${`fairdrops.indexer:${this.key.chainId}:${this.key.contractAddress}`}, 0)
          ) AS locked`;
        if (!lock?.locked) throw new LostRace();

        const { count } = await tx.chainSync.updateMany({
          where: { ...this.key, cursor: state.cursor },
          data: {
            cursor: last?.id ?? state.cursor,
            cursorBlockHash: last?.blockHash ?? state.cursorBlockHash,
            syncedBlock,
            ...this.metaFields(batch.meta),
          },
        });
        if (count !== 1) throw new LostRace();

        for (const event of events) await applyEvent(tx, this.key, event);
      },
      { maxWait: 10_000, timeout: 60_000 },
    );

    return events.length > 0
      ? { status: "applied", events: events.length, syncedBlock, more }
      : { status: "idle", syncedBlock };
  }

  private async recordMeta(meta: SubgraphMeta): Promise<void> {
    await this.db.chainSync.updateMany({ where: this.key, data: this.metaFields(meta) });
  }

  private metaFields(meta: SubgraphMeta) {
    return {
      headBlock: meta.block,
      deployment: meta.deployment,
      ...(meta.hasIndexingErrors
        ? {
            lastError: `Subgraph ${meta.deployment} has indexing errors and stopped at block ${meta.block}`,
            lastErrorAt: new Date(),
          }
        : { lastError: null, lastErrorAt: null }),
    };
  }

  private async halt(reason: string): Promise<SyncOutcome> {
    await this.db.chainSync.updateMany({
      where: this.key,
      data: { haltedAt: new Date(), lastError: reason, lastErrorAt: new Date() },
    });
    return { status: "halted", reason };
  }
}

/** Deletes a deployment's copied state so the next sync rebuilds it from the first event. */
export async function resetChain(
  db: Database,
  key: { chainId: number; contractAddress: string },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const giveaways = { chainId: key.chainId, contractAddress: key.contractAddress };
    await tx.giveawayEvent.deleteMany({ where: { giveaway: giveaways } });
    await tx.giveaway.deleteMany({ where: giveaways });
    await tx.payoutWallet.deleteMany({ where: key });
    await tx.chainSync.upsert({
      where: { chainId_contractAddress: key },
      create: key,
      update: {
        cursor: EVENT_ID_ZERO,
        cursorBlockHash: null,
        syncedBlock: 0,
        headBlock: null,
        deployment: null,
        lastError: null,
        lastErrorAt: null,
        haltedAt: null,
      },
    });
  });
}

/**
 * Failures that repeat on every retry because the data, not the network, is wrong: an event the
 * stored state cannot accept, a malformed event, or a database invariant it would break.
 */
function permanentFailure(error: unknown): string | null {
  if (error instanceof ProjectionError || error instanceof MalformedEventError) {
    return error.message;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
    return `An event was applied twice: ${error.message}`;
  }
  const check = /violates check constraint "([^"]+)"/.exec(describe(error));
  if (check) return `Applying the batch would break the ${check[1]} invariant`;
  return null;
}

function describe(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error; e instanceof Error && parts.length < 4; e = e.cause) {
    parts.push(e.message);
  }
  return parts.length > 0 ? parts.join(": ") : String(error);
}
