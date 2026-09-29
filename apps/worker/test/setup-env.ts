import { workerTestDatabaseUrl } from "./database.js";

// Tests run against real Postgres and Redis (pnpm infra:up), isolated from development data and
// from the API's tests (which use Redis index 15). Background loops stay off; tests drive the
// indexer, planner and runtime directly.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = workerTestDatabaseUrl();
process.env.REDIS_URL = process.env.TEST_WORKER_REDIS_URL ?? "redis://localhost:6379/14";
process.env.DEPLOYMENT_ENVIRONMENT = "testnet";
process.env.INDEXER_ENABLED = "false";
process.env.SESSIONS_ENABLED = "false";
process.env.SESSION_SEED_KEY = "11".repeat(32);
