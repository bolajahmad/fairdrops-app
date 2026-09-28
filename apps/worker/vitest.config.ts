import { defineConfig, mergeConfig } from "vitest/config";
import { createNestTestConfig } from "@fairdrops/config/vitest/nest";

export default mergeConfig(
  createNestTestConfig(),
  defineConfig({
    test: {
      globalSetup: ["./test/global-setup.ts"],
      setupFiles: ["./test/setup-env.ts"],
      // Integration tests share one Postgres database.
      fileParallelism: false,
    },
  }),
);
