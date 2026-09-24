import swc from "unplugin-swc";
import { defineConfig, mergeConfig } from "vitest/config";
import { createNodeTestConfig } from "./node.js";

/**
 * Vitest transpiles with esbuild, which does not emit decorator metadata.
 * SWC is used instead so Nest dependency injection works under test.
 */
export function createNestTestConfig() {
  return mergeConfig(
    createNodeTestConfig(),
    defineConfig({
      plugins: [
        swc.vite({
          module: { type: "es6" },
          jsc: {
            target: "es2022",
            parser: { syntax: "typescript", decorators: true },
            transform: { legacyDecorator: true, decoratorMetadata: true },
          },
        }),
      ],
      oxc: false,
    }),
  );
}
