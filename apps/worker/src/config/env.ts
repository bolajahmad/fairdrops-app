import { deploymentEnvironmentSchema } from "@fairdrops/shared";
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

/** `10143=https://...,84532=https://...`: a subgraph URL per chain, overriding Goldsky's. */
const endpointMap = z
  .string()
  .default("")
  .transform((value, ctx) => {
    const endpoints = new Map<number, string>();
    for (const entry of value.split(",").map((item) => item.trim())) {
      if (!entry) continue;
      const match = /^(\d+)=(https?:\/\/\S+)$/.exec(entry);
      if (!match) {
        ctx.addIssue({ code: "custom", message: `Expected chainId=url, got "${entry}"` });
        return z.NEVER;
      }
      endpoints.set(Number(match[1]), match[2]!);
    }
    return endpoints;
  });

/** `84532=https://a,84532=https://b,10143=https://c`: RPC URLs per chain, tried in order. */
const rpcUrlMap = z
  .string()
  .default("")
  .transform((value, ctx) => {
    const urls = new Map<number, string[]>();
    for (const entry of value.split(",").map((item) => item.trim())) {
      if (!entry) continue;
      const match = /^(\d+)=(https?:\/\/\S+)$/.exec(entry);
      if (!match) {
        ctx.addIssue({ code: "custom", message: `Expected chainId=url, got "${entry}"` });
        return z.NEVER;
      }
      const chainId = Number(match[1]);
      urls.set(chainId, [...(urls.get(chainId) ?? []), match[2]!]);
    }
    return urls;
  });

const privateKey = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, "Expected a 32-byte private key as hex");

const privateKeyList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(privateKey));

const chainIdList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map(Number),
  )
  .pipe(z.array(z.number().int().positive()));

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_VERSION: z.string().min(1).default("0.0.0"),
    /** Which chains to index: those of this environment with a FairDrops deployment. */
    DEPLOYMENT_ENVIRONMENT: deploymentEnvironmentSchema.default("testnet"),

    DATABASE_URL: z.url(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(5),

    INDEXER_ENABLED: booleanString.default(true),
    /** Only index these chain ids. Empty means every indexable chain in the environment. */
    INDEXER_CHAIN_IDS: chainIdList,
    /** Pause between polls once a chain has caught up. */
    INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(4_000),
    /** Events copied per transaction. The subgraph returns at most 1000 per query. */
    INDEXER_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(500),

    /** Goldsky project the subgraphs are deployed to, e.g. project_cl8ylkiw00krx0hvza0qw17vn. */
    GOLDSKY_PROJECT_ID: z
      .string()
      .regex(/^project_[a-z0-9]+$/)
      .optional(),
    /** Reads the private endpoints when set. Public endpoints are rate limited per IP. */
    GOLDSKY_API_TOKEN: z.string().min(1).optional(),
    SUBGRAPH_ENDPOINTS: endpointMap,

    REDIS_URL: z.url().default("redis://localhost:6379"),

    /** Plan, start and run game sessions. Turn off on workers that should only index. */
    SESSIONS_ENABLED: booleanString.default(true),
    /**
     * 32-byte hex key that encrypts session seeds at rest. Required in production; elsewhere a
     * fixed development key is used when unset.
     */
    SESSION_SEED_KEY: z
      .string()
      .regex(/^(0x)?[0-9a-fA-F]{64}$/, "Expected 32 bytes as hex")
      .optional(),
    /** Holds OPERATOR_ROLE on the FairDrops contracts and commits session seeds. */
    OPERATOR_PRIVATE_KEY: privateKey.optional(),
    /** How often the planner creates sessions and reconciles their status. */
    SESSION_PLANNER_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
    /** Time kept free between the end of play and the giveaway's finalize deadline. */
    SESSION_SETTLEMENT_MARGIN_SECONDS: z.coerce.number().int().min(0).max(86_400).default(900),
    /** How long before the start a session opens its lobby. */
    SESSION_LOBBY_LEAD_SECONDS: z.coerce.number().int().min(0).max(86_400).default(300),
    /** Games one worker runs at a time. Others wait for a worker with room. */
    SESSION_MAX_OWNED: z.coerce.number().int().min(1).max(10_000).default(50),
    /** How long a worker's hold on a running game lasts without renewal. */
    SESSION_LEASE_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),

    /** Extra RPC endpoints per chain, tried before the registry's public ones. */
    RPC_URLS: rpcUrlMap,

    /** Build, sign, submit and confirm settlements, relay claims and unwind failed games. */
    SETTLEMENT_ENABLED: booleanString.default(true),
    /** How often the settlement reconciler looks for work. */
    SETTLEMENT_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(3_000),
    /**
     * Keys holding VERIFIER_ROLE, comma-separated. A worker with keys checks every proposed
     * settlement independently and signs the ones that hold up. Run verifiers as separate
     * processes (SESSIONS_ENABLED, INDEXER_ENABLED and SETTLEMENT_ENABLED off) to spread trust.
     */
    VERIFIER_PRIVATE_KEYS: privateKeyList,
    /** Pays for finalize and relayed claims. Defaults to the operator key. */
    RELAYER_PRIVATE_KEY: privateKey.optional(),
    /** Claim prizes on winners' behalf after finalization, so winners need no gas. */
    CLAIM_RELAY_ENABLED: booleanString.default(true),
    /** Claims per claimMany transaction. */
    CLAIM_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25),
    /** Cancel on-chain the giveaways of games that failed or were cancelled, so hosts get refunds. */
    UNWIND_ENABLED: booleanString.default(true),
    /** How long to wait for a transaction before looking again on the next pass. */
    TX_RECEIPT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(90_000),
    /** Rebroadcast with higher fees when a transaction has not been mined for this long. */
    TX_BUMP_AFTER_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
    TX_MAX_FEE_BUMPS: z.coerce.number().int().min(0).max(20).default(5),
    /** Warn when a signing key's balance on a chain falls below this, in wei. */
    LOW_BALANCE_WEI: z.coerce
      .bigint()
      .nonnegative()
      .default(10n ** 16n),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.SESSIONS_ENABLED && !env.SESSION_SEED_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_SEED_KEY"],
        message: "Required in production, so seeds stay secret and survive restarts",
      });
    }
  });

export type WorkerEnv = z.infer<typeof envSchema>;

export const WORKER_ENV = Symbol("WORKER_ENV");

export function parseWorkerEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  // `KEY=` in a .env file means "not set", not "set to an empty string".
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = envSchema.safeParse(defined);
  if (!result.success) {
    throw new Error(`Invalid worker environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
