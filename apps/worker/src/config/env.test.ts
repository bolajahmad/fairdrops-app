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

  it("parses settlement keys and per-chain RPC endpoints", () => {
    const env = parseWorkerEnv({
      ...base,
      VERIFIER_PRIVATE_KEYS: `${"b1".repeat(32)}, 0x${"b2".repeat(32)}`,
      RPC_URLS: "84532=https://a.test,84532=https://b.test,10143=https://c.test",
    });
    expect(env.VERIFIER_PRIVATE_KEYS).toHaveLength(2);
    expect(env.RPC_URLS.get(84532)).toEqual(["https://a.test", "https://b.test"]);
    expect(env).toMatchObject({ SETTLEMENT_ENABLED: true, CLAIM_RELAY_ENABLED: true });
    expect(parseWorkerEnv(base).VERIFIER_PRIVATE_KEYS).toEqual([]);
  });

  it("treats empty values as unset", () => {
    expect(parseWorkerEnv({ ...base, GOLDSKY_PROJECT_ID: "" }).GOLDSKY_PROJECT_ID).toBeUndefined();
  });

  it.each([
    ["SUBGRAPH_ENDPOINTS", "10143:https://x.test"],
    ["INDEXER_CHAIN_IDS", "monad"],
    ["INDEXER_BATCH_SIZE", "5000"],
    ["GOLDSKY_PROJECT_ID", "my project"],
    ["VERIFIER_PRIVATE_KEYS", "0x1234"],
    ["RPC_URLS", "84532:https://a.test"],
  ])("rejects a malformed %s", (name, value) => {
    expect(() => parseWorkerEnv({ ...base, [name]: value })).toThrow(name);
  });
});
