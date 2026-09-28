import { createPrismaClient } from "@fairdrops/db";
import { resetDatabase } from "@fairdrops/db/testing";
import { toHex } from "viem";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ChainIndexer, resetChain } from "../src/indexer/chain-indexer.js";
import {
  CHAIN,
  CONTRACT,
  FakeSubgraph,
  GIVEAWAY,
  HOST,
  TARGET,
  WALLET,
  WINNER,
  ZERO,
  blockHash,
  eventId,
  events,
  validMetadata,
} from "./fake-subgraph.js";

const db = createPrismaClient({ connectionString: process.env.DATABASE_URL! });
const key = { chainId: CHAIN.chainId, contractAddress: CONTRACT };
const giveawayKey = { chainId_giveawayId: { chainId: CHAIN.chainId, giveawayId: GIVEAWAY } };

let subgraph: FakeSubgraph;

function indexer(batchSize = 100): ChainIndexer {
  return new ChainIndexer(TARGET, subgraph, db, batchSize);
}

async function syncAll(target = indexer()): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const outcome = await target.syncOnce();
    if (outcome.status !== "applied" || !outcome.more) return;
  }
  throw new Error("Sync did not settle");
}

const giveaway = () => db.giveaway.findUniqueOrThrow({ where: giveawayKey });
const syncState = () => db.chainSync.findUniqueOrThrow({ where: { chainId_contractAddress: key } });

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(db);
  subgraph = new FakeSubgraph();
});

describe("ChainIndexer", () => {
  it("builds a giveaway and its activity log from the full lifecycle", async () => {
    subgraph.add(
      events.created(100, 3),
      events.fundsAdded(101, 495n, 5n),
      events.seedCommitted(102),
      events.finalized(110, 1000n),
      events.claimed(111, 600n),
      events.hostWithdrawal(112, 485n),
    );
    subgraph.head = 120n;

    await expect(indexer().syncOnce()).resolves.toEqual({
      status: "applied",
      events: 6,
      syncedBlock: 119n,
      more: false,
    });

    const row = await giveaway();
    expect(row).toMatchObject({
      contractAddress: CONTRACT,
      host: HOST,
      token: ZERO,
      status: "FINALIZED",
      maxWinners: 3,
      winnerCount: 2,
      seedCommitment: `0x${"c".repeat(64)}`,
      seed: `0x${"e".repeat(64)}`,
      metadataError: null,
      startTime: new Date(1_790_000_600_000),
      createdBlock: 100n,
      updatedBlock: 112n,
    });
    expect(row.metadata).toMatchObject({ title: "Launch party" });
    expect(toHex(row.metadataRaw)).toBe(validMetadata.hex);
    expect(row.prize.toString()).toBe("1485");
    expect(row.fee.toString()).toBe("15");
    expect(row.totalPayout.toString()).toBe("1000");
    expect(row.claimed.toString()).toBe("600");
    expect(row.withdrawn.toString()).toBe("485");

    const log = await db.giveawayEvent.findMany({
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    });
    expect(log.map((e) => e.kind)).toEqual([
      "CREATED",
      "FUNDS_ADDED",
      "SEED_COMMITTED",
      "FINALIZED",
      "CLAIMED",
      "HOST_WITHDRAWAL",
    ]);
    expect(log[0]).toMatchObject({ logIndex: 3, account: HOST });
    expect(log[0]!.amount!.toString()).toBe("990");
    expect(log[4]).toMatchObject({ account: WINNER, recipient: WALLET });

    await expect(syncState()).resolves.toMatchObject({
      cursor: eventId(112, 0),
      cursorBlockHash: blockHash(112),
      syncedBlock: 119n,
      headBlock: 120n,
      deployment: "QmFake",
      lastError: null,
      haltedAt: null,
    });
  });

  it("only copies events that have the chain's confirmations", async () => {
    subgraph.add(events.created(100), events.seedCommitted(101));
    subgraph.head = 101n;

    await expect(indexer().syncOnce()).resolves.toMatchObject({ events: 1, syncedBlock: 100n });
    await expect(giveaway()).resolves.toMatchObject({ seedCommitment: null });

    subgraph.head = 102n;
    await expect(indexer().syncOnce()).resolves.toMatchObject({ events: 1, syncedBlock: 101n });
    await expect(giveaway()).resolves.toMatchObject({ seedCommitment: `0x${"c".repeat(64)}` });
  });

  it("copies in batches and resumes from the cursor after a restart", async () => {
    subgraph.add(
      events.created(100),
      events.fundsAdded(100, 10n, 0n, 1),
      events.fundsAdded(100, 10n, 0n, 2),
      events.fundsAdded(101, 10n, 0n),
      events.fundsAdded(102, 10n, 0n),
    );
    subgraph.head = 110n;

    await expect(indexer(2).syncOnce()).resolves.toEqual({
      status: "applied",
      events: 2,
      syncedBlock: 99n,
      more: true,
    });
    // A new instance stands in for a restarted worker.
    await syncAll(indexer(2));

    const row = await giveaway();
    expect(row.prize.toString()).toBe("1030");
    await expect(db.giveawayEvent.count()).resolves.toBe(5);
    await expect(syncState()).resolves.toMatchObject({ syncedBlock: 109n });
  });

  it("is idempotent once caught up", async () => {
    subgraph.add(events.created(100), events.fundsAdded(101, 10n, 1n));
    subgraph.head = 105n;
    await syncAll();

    const calls = subgraph.calls;
    await expect(indexer().syncOnce()).resolves.toEqual({ status: "idle", syncedBlock: 104n });
    expect(subgraph.calls).toBe(calls + 1);
    await expect(db.giveawayEvent.count()).resolves.toBe(2);
    expect((await giveaway()).prize.toString()).toBe("1000");
  });

  it("applies each event once when two workers sync the same chain concurrently", async () => {
    subgraph.add(events.created(100), events.fundsAdded(101, 10n, 1n));
    subgraph.head = 105n;

    const outcomes = await Promise.all([indexer().syncOnce(), indexer().syncOnce()]);

    expect(outcomes.map((o) => o.status).sort()).toEqual(["applied", "busy"]);
    await expect(db.giveawayEvent.count()).resolves.toBe(2);
    expect((await giveaway()).prize.toString()).toBe("1000");
  });

  it("stores giveaways with invalid metadata and the reason, so they are never played", async () => {
    const metadata = toHex(new TextEncoder().encode('{"title":"missing fields"}'));
    subgraph.add(events.created(100, 0, { metadata }));
    subgraph.head = 105n;

    await syncAll();

    await expect(giveaway()).resolves.toMatchObject({
      metadata: null,
      metadataError: expect.stringContaining("Invalid discriminator value") as string,
    });
  });

  it("halts when the metadata does not match the hash the contract emitted", async () => {
    subgraph.add(events.created(100, 0, { metadataHash: `0x${"9".repeat(64)}` }));
    subgraph.head = 105n;

    await expect(indexer().syncOnce()).resolves.toMatchObject({
      status: "halted",
      reason: expect.stringContaining("does not hash to metadataHash") as string,
    });
    await expect(db.giveaway.count()).resolves.toBe(0);
  });

  it("halts without writing anything when an event does not fit the stored state", async () => {
    subgraph.add(events.created(100), events.seedCommitted(101), events.claimed(102, 5n));
    subgraph.head = 110n;

    const outcome = await indexer().syncOnce();

    expect(outcome).toMatchObject({ status: "halted" });
    expect(outcome.status === "halted" && outcome.reason).toMatch(
      /Claimed at 102:0 .* \(status ACTIVE, seed committed; expected FINALIZED\)/,
    );
    await expect(db.giveaway.count()).resolves.toBe(0);
    await expect(syncState()).resolves.toMatchObject({
      cursor: eventId(0, 0),
      haltedAt: expect.any(Date) as Date,
    });

    // It stays halted, without querying the subgraph, until an operator clears it.
    const calls = subgraph.calls;
    await expect(indexer().syncOnce()).resolves.toMatchObject({ status: "halted" });
    expect(subgraph.calls).toBe(calls);
  });

  it("halts when a database invariant would break", async () => {
    subgraph.add(
      events.created(100),
      events.seedCommitted(101),
      events.finalized(102, 900n),
      events.claimed(103, 901n),
    );
    subgraph.head = 110n;

    await expect(indexer().syncOnce()).resolves.toMatchObject({
      status: "halted",
      reason: expect.stringContaining("giveaways_claimed_within_payout") as string,
    });
  });

  it("halts when a reorg replaces a block beneath the cursor", async () => {
    subgraph.add(events.created(100));
    subgraph.head = 105n;
    await syncAll();

    subgraph.rows[0] = { ...subgraph.rows[0]!, blockHash: blockHash(100, 1) };
    subgraph.add(events.fundsAdded(106, 1n, 0n));
    subgraph.head = 110n;

    await expect(indexer().syncOnce()).resolves.toMatchObject({
      status: "halted",
      reason: expect.stringContaining("reorg") as string,
    });
    expect((await giveaway()).prize.toString()).toBe("990");
  });

  it("only claims the blocks the answering replica had indexed", async () => {
    subgraph.add(events.created(100));
    subgraph.head = 200n;
    subgraph.replicaBlock = 150n;

    await expect(indexer().syncOnce()).resolves.toMatchObject({ syncedBlock: 150n });

    subgraph.add(events.fundsAdded(160, 10n, 0n));
    subgraph.replicaBlock = null;
    await syncAll();
    expect((await giveaway()).prize.toString()).toBe("1000");
  });

  it("records subgraph indexing errors but keeps copying what is indexed", async () => {
    subgraph.add(events.created(100));
    subgraph.head = 105n;
    subgraph.hasIndexingErrors = true;

    await expect(indexer().syncOnce()).resolves.toMatchObject({ status: "applied" });
    await expect(syncState()).resolves.toMatchObject({
      lastError: expect.stringContaining("indexing errors") as string,
      haltedAt: null,
    });
  });

  it("tracks payout wallets and ignores configuration events", async () => {
    subgraph.add(
      events.roleGranted(100),
      events.payoutWalletSet(101, WALLET),
      events.payoutWalletSet(102, HOST),
    );
    subgraph.head = 105n;
    await syncAll();

    await expect(db.payoutWallet.findMany()).resolves.toMatchObject([
      { account: WINNER, wallet: HOST, updatedBlock: 102n, contractAddress: CONTRACT },
    ]);

    subgraph.add(events.payoutWalletSet(106, ZERO));
    subgraph.head = 110n;
    await syncAll();
    await expect(db.payoutWallet.count()).resolves.toBe(0);
  });

  it("rebuilds a chain from scratch after a reset", async () => {
    subgraph.add(events.created(100), events.cancelled(101));
    subgraph.head = 105n;
    await syncAll();
    await db.chainSync.update({
      where: { chainId_contractAddress: key },
      data: { haltedAt: new Date(), lastError: "stuck" },
    });

    await resetChain(db, key);
    await expect(db.giveaway.count()).resolves.toBe(0);

    await syncAll();
    await expect(giveaway()).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(syncState()).resolves.toMatchObject({ haltedAt: null, lastError: null });
  });
});
