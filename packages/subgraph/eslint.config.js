import { defineConfig } from "eslint/config";
import { createBaseConfig } from "@fairdrops/config/eslint/base";

// Mappings and their tests are AssemblyScript, which `graph build` and `graph test` check.
export default defineConfig(
  { ignores: ["src/**", "tests/**", "generated/**", "build/**"] },
  createBaseConfig({ tsconfigRootDir: import.meta.dirname }),
);
