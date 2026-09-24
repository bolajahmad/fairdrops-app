import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import { defineConfig } from "eslint/config";
import globals from "globals";
import { createBaseConfig } from "./base.js";

/**
 * @param {{ tsconfigRootDir: string }} options
 */
export function createNextConfig(options) {
  return defineConfig(nextCoreWebVitals, createBaseConfig(options), {
    languageOptions: {
      globals: { ...globals.browser },
    },
  });
}
