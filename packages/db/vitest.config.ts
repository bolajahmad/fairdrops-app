import { defineConfig, mergeConfig } from "vitest/config";
import { createNodeTestConfig } from "@fairdrops/config/vitest/node";

export default mergeConfig(
  createNodeTestConfig(),
  defineConfig({
    test: {
      globalSetup: ["./test/global-setup.ts"],
      // Test files share one database, so they run one at a time.
      fileParallelism: false,
    },
  }),
);
