import { defineConfig } from "eslint/config";
import { createBaseConfig } from "./base.js";

/**
 * Nest resolves providers from emitted constructor metadata, so class imports
 * used only as parameter types must stay value imports.
 *
 * @param {{ tsconfigRootDir: string }} options
 */
export function createNestConfig(options) {
  return defineConfig(createBaseConfig(options), {
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/no-extraneous-class": "off",
    },
  });
}
