import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "./env.js";

const base = { DATABASE_URL: "postgresql://fairdrops@localhost:5432/fairdrops" };

describe("parseWorkerEnv", () => {
  it("applies defaults", () => {
    expect(parseWorkerEnv(base)).toMatchObject({
      DEPLOYMENT_ENVIRONMENT: "testnet",
      INDEXER_ENABLED: true,
      INDEXER_CHAIN_IDS: [],
      INDEXER_POLL_INTERVAL_MS: 4000,
      INDEXER_BATCH_SIZE: 500,
    });
  });

  it("parses chain ids and per-chain subgraph endpoints", () => {
    const env = parseWorkerEnv({
      ...base,
      INDEXER_CHAIN_IDS: "10143, 84532",
      SUBGRAPH_ENDPOINTS:
        "10143=http://localhost:8000/subgraphs/name/fairdrops,84532=https://x.test/gn",
    });
    expect(env.INDEXER_CHAIN_IDS).toEqual([10143, 84532]);
    expect(env.SUBGRAPH_ENDPOINTS.get(10143)).toBe(
      "http://localhost:8000/subgraphs/name/fairdrops",
    );
    expect(env.SUBGRAPH_ENDPOINTS.get(84532)).toBe("https://x.test/gn");
  });

  it("treats empty values as unset", () => {
    expect(parseWorkerEnv({ ...base, GOLDSKY_PROJECT_ID: "" }).GOLDSKY_PROJECT_ID).toBeUndefined();
  });

  it.each([
    ["SUBGRAPH_ENDPOINTS", "10143:https://x.test"],
    ["INDEXER_CHAIN_IDS", "monad"],
    ["INDEXER_BATCH_SIZE", "5000"],
    ["GOLDSKY_PROJECT_ID", "my project"],
  ])("rejects a malformed %s", (name, value) => {
    expect(() => parseWorkerEnv({ ...base, [name]: value })).toThrow(name);
  });
});
