import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "../config/env.js";
import { resolveTargets } from "./targets.js";

const env = (values: Record<string, string>) =>
  parseWorkerEnv({ DATABASE_URL: "postgresql://fairdrops@localhost/fairdrops", ...values });

describe("resolveTargets", () => {
  it("indexes every deployed testnet chain Goldsky supports", () => {
    const targets = resolveTargets(env({ GOLDSKY_PROJECT_ID: "project_abc123" }));

    expect(targets.map((t) => t.chain.key)).toEqual(["monad-testnet", "sepolia", "base-sepolia"]);
    expect(targets[0]).toMatchObject({
      contractAddress: "0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca",
      endpoint:
        "https://api.goldsky.com/api/public/project_abc123/subgraphs/fairdrops-monad-testnet/prod/gn",
    });
  });

  it("uses private endpoints when an API token is set", () => {
    const [target] = resolveTargets(
      env({ GOLDSKY_PROJECT_ID: "project_abc123", GOLDSKY_API_TOKEN: "secret" }),
    );
    expect(target!.endpoint).toMatch(/^https:\/\/api\.goldsky\.com\/api\/private\//);
  });

  it("narrows to INDEXER_CHAIN_IDS and prefers explicit endpoints", () => {
    const targets = resolveTargets(
      env({ INDEXER_CHAIN_IDS: "84532", SUBGRAPH_ENDPOINTS: "84532=http://localhost:8000/gn" }),
    );
    expect(targets).toMatchObject([
      { chain: { key: "base-sepolia" }, endpoint: "http://localhost:8000/gn" },
    ]);
  });

  it("rejects chains that cannot be indexed", () => {
    expect(() =>
      resolveTargets(env({ GOLDSKY_PROJECT_ID: "project_abc123", INDEXER_CHAIN_IDS: "420420417" })),
    ).toThrow("not an indexable testnet chain");
  });

  it("requires a way to reach each subgraph", () => {
    expect(() => resolveTargets(env({}))).toThrow("No subgraph endpoint for monad-testnet");
  });

  it("has nothing to index locally", () => {
    expect(resolveTargets(env({ DEPLOYMENT_ENVIRONMENT: "local" }))).toEqual([]);
  });
});
