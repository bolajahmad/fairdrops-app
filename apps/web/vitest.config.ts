import { defineConfig, mergeConfig } from "vitest/config";
import { createNodeTestConfig } from "@fairdrops/config/vitest/node";

export default mergeConfig(
  createNodeTestConfig(),
  defineConfig({
    test: {
      include: ["lib/**/*.test.ts", "src/**/*.test.ts", "test/**/*.test.ts"],
    },
  }),
);
