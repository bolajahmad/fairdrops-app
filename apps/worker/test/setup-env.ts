import { workerTestDatabaseUrl } from "./database.js";

// Tests run against real Postgres (pnpm infra:up), isolated from development data. The indexer
// loops stay off unless a test starts them with a fake subgraph.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = workerTestDatabaseUrl();
process.env.DEPLOYMENT_ENVIRONMENT = "testnet";
process.env.INDEXER_ENABLED = "false";
