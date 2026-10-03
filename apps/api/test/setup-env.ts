import { DEFAULT_TEST_DATABASE_URL } from "@fairdrops/db/testing";

// Tests run against real Postgres and Redis (pnpm infra:up), isolated from development data.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
process.env.APP_ORIGINS = "http://localhost:3000";
process.env.DEPLOYMENT_ENVIRONMENT = "testnet";
process.env.RELAYER_ADDRESS = "0x215ba01637f2bbf91fcf5fb4df6d41bc64820d65";
