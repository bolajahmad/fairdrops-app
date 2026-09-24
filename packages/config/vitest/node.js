import { defineConfig } from "vitest/config";

export function createNodeTestConfig() {
  return defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "test/**/*.test.ts"],
      passWithNoTests: false,
    },
  });
}
