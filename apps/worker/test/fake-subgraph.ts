import { encodeGiveawayMetadata, findChain, type Address, type Hex } from "@fairdrops/shared";
import { keccak256, toHex } from "viem";
import type { RawEvent } from "../src/indexer/events.js";
import type {
  EventBatch,
  EventQuery,
  SubgraphClient,
  SubgraphMeta,
} from "../src/indexer/subgraph-client.js";
import type { IndexTarget } from "../src/indexer/targets.js";

export const CHAIN = findChain(10143)!;
export const CONTRACT = "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72" as Address;
export const TARGET: IndexTarget = {
  chain: CHAIN,
  contractAddress: CONTRACT,
  endpoint: "https://subgraph.test/monad-testnet",
};

export const HOST = "0x00000000000000000000000000000000000000a1" as Address;
export const WINNER = "0x00000000000000000000000000000000000000b2" as Address;
export const WALLET = "0x00000000000000000000000000000000000000c3" as Address;
export const ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const GIVEAWAY: Hex = `0x${"1".repeat(64)}`;

export const START = 1_790_000_600n;
export const DEADLINE = 1_790_086_400n;

const hash = (char: string): Hex => `0x${char.repeat(64)}`;

/** Event id as the subgraph mapping builds it. */
export function eventId(block: number, logIndex: number): string {
  return `0x${block.toString(16).padStart(16, "0")}${logIndex.toString(16).padStart(8, "0")}`;
}

export function blockHash(block: number, fork = 0): Hex {
  return `0x${(block * 1000 + fork).toString(16).padStart(64, "0")}`;
}

function base(kind: string, block: number, logIndex: number): RawEvent {
  return {
    id: eventId(block, logIndex),
    kind,
    blockNumber: BigInt(block),
    blockHash: blockHash(block),
    timestamp: 1_790_000_000n + BigInt(block),
    transactionHash: toHex(block * 100 + logIndex, { size: 32 }),
    logIndex: BigInt(logIndex),
  };
}

export const validMetadata = encodeGiveawayMetadata({
  v: 1,
  title: "Launch party",
  description: "Win MON",
  game: { id: "quiz", version: "1.0.0", config: {} },
});

export const events = {
  created(
    block: number,
    logIndex = 0,
    options: { prize?: bigint; fee?: bigint; metadata?: Hex; metadataHash?: Hex } = {},
  ): RawEvent {
    const metadata = options.metadata ?? validMetadata.hex;
    return {
      ...base("GiveawayCreated", block, logIndex),
      giveaway: { id: GIVEAWAY },
      host: HOST,
      token: ZERO,
      prize: options.prize ?? 990n,
      fee: options.fee ?? 10n,
      startTime: START,
      finalizeDeadline: DEADLINE,
      maxWinners: 3n,
      claimWindow: 2_592_000n,
      metadataHash: options.metadataHash ?? keccak256(metadata),
      metadata,
    };
  },
  fundsAdded(block: number, prizeAdded: bigint, feeAdded: bigint, logIndex = 0): RawEvent {
    return {
      ...base("FundsAdded", block, logIndex),
      giveaway: { id: GIVEAWAY },
      from: HOST,
      prizeAdded,
      feeAdded,
    };
  },
  seedCommitted(block: number, logIndex = 0): RawEvent {
    return {
      ...base("SeedCommitted", block, logIndex),
      giveaway: { id: GIVEAWAY },
      commitment: hash("c"),
    };
  },
  finalized(block: number, totalPayout: bigint, logIndex = 0): RawEvent {
    return {
      ...base("GiveawayFinalized", block, logIndex),
      giveaway: { id: GIVEAWAY },
      payoutRoot: hash("d"),
      totalPayout,
      winnerCount: 2n,
      seed: hash("e"),
      transcriptHash: hash("f"),
      claimDeadline: 1_792_592_000n,
    };
  },
  cancelled(block: number, logIndex = 0): RawEvent {
    return { ...base("GiveawayCancelled", block, logIndex), giveaway: { id: GIVEAWAY }, by: HOST };
  },
  claimed(block: number, amount: bigint, logIndex = 0): RawEvent {
    return {
      ...base("Claimed", block, logIndex),
      giveaway: { id: GIVEAWAY },
      account: WINNER,
      recipient: WALLET,
      amount,
    };
  },
  hostWithdrawal(block: number, amount: bigint, logIndex = 0): RawEvent {
    return {
      ...base("HostWithdrawal", block, logIndex),
      giveaway: { id: GIVEAWAY },
      host: HOST,
      recipient: HOST,
      amount,
    };
  },
  payoutWalletSet(block: number, wallet: Address, logIndex = 0): RawEvent {
    return { ...base("PayoutWalletSet", block, logIndex), account: WINNER, wallet };
  },
  roleGranted(block: number, logIndex = 0): RawEvent {
    return { ...base("RoleGranted", block, logIndex), account: WINNER };
  },
};

/**
 * An in-memory subgraph with the same query semantics as the real one: events ordered by id,
 * filtered by `id_gt` and `blockNumber_lte`, answered as of a single block.
 */
export class FakeSubgraph implements SubgraphClient {
  rows: RawEvent[] = [];
  head = 0n;
  deployment = "QmFake";
  hasIndexingErrors = false;
  /** When set, the events query is answered by a replica that has only indexed up to here. */
  replicaBlock: bigint | null = null;
  calls = 0;

  add(...rows: RawEvent[]): this {
    this.rows.push(...rows);
    this.rows.sort((a, b) => (a.id < b.id ? -1 : 1));
    const top = rows.reduce((max, row) => (row.blockNumber > max ? row.blockNumber : max), 0n);
    if (top > this.head) this.head = top;
    return this;
  }

  meta(): Promise<SubgraphMeta> {
    this.calls += 1;
    return Promise.resolve(this.metaAt(this.head));
  }

  events({ after, maxBlock, first }: EventQuery): Promise<EventBatch> {
    this.calls += 1;
    const answeredAt = this.replicaBlock ?? this.head;
    const visible = this.rows.filter((row) => row.blockNumber <= answeredAt);
    return Promise.resolve({
      meta: this.metaAt(answeredAt),
      anchorBlockHash: visible.find((row) => row.id === after)?.blockHash ?? null,
      events: visible
        .filter((row) => row.id > after && row.blockNumber <= maxBlock)
        .slice(0, first),
    });
  }

  private metaAt(block: bigint): SubgraphMeta {
    return { block, deployment: this.deployment, hasIndexingErrors: this.hasIndexingErrors };
  }
}
