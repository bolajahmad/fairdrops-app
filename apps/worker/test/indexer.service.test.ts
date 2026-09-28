import { Test, type TestingModule } from "@nestjs/testing";
import { resetDatabase } from "@fairdrops/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SUBGRAPH_CLIENT_FACTORY, IndexerService } from "../src/indexer/indexer.service.js";
import { PRISMA, type Database } from "../src/infra/prisma.module.js";
import { WorkerModule } from "../src/worker.module.js";
import { FakeSubgraph, GIVEAWAY, events } from "./fake-subgraph.js";

const overrides = {
  INDEXER_ENABLED: "true",
  INDEXER_CHAIN_IDS: "10143",
  INDEXER_POLL_INTERVAL_MS: "250",
  SUBGRAPH_ENDPOINTS: "10143=https://subgraph.test/monad-testnet",
};

describe("IndexerService", () => {
  let moduleRef: TestingModule;
  let subgraph: FakeSubgraph;
  let db: Database;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const [name, value] of Object.entries(overrides)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
    subgraph = new FakeSubgraph();
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(SUBGRAPH_CLIENT_FACTORY)
      .useValue(() => subgraph)
      .compile();
    moduleRef.useLogger(false);
    db = moduleRef.get<Database>(PRISMA);
    await resetDatabase(db);
  });

  afterEach(async () => {
    await moduleRef.close();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("keeps a chain in sync until shutdown", async () => {
    expect(moduleRef.get(IndexerService).indexers.map((i) => i.target.chain.key)).toEqual([
      "monad-testnet",
    ]);
    await moduleRef.init();

    subgraph.add(events.created(100));
    subgraph.head = 105n;
    await expect
      .poll(() => db.giveaway.count({ where: { giveawayId: GIVEAWAY } }), { timeout: 5_000 })
      .toBe(1);

    subgraph.add(events.fundsAdded(106, 10n, 0n));
    subgraph.head = 110n;
    await expect
      .poll(async () => (await db.giveaway.findFirstOrThrow()).prize.toString(), { timeout: 5_000 })
      .toBe("1000");

    await moduleRef.close();
    const calls = subgraph.calls;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(subgraph.calls).toBe(calls);
  });
});
