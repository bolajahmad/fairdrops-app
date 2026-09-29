import { createNodeTestConfig } from "@fairdrops/config/vitest/node";

// Unit tests with stubbed fetch and WebSocket. The SDK against a real API is tested in
// apps/api/test/sdk.test.ts, and against testnets by scripts/e2e.
export default createNodeTestConfig();
