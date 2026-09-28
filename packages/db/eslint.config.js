import { defineConfig } from "eslint/config";
import { createBaseConfig } from "@fairdrops/config/eslint/base";

export default defineConfig(
  { ignores: ["src/generated/**"] },
  createBaseConfig({ tsconfigRootDir: import.meta.dirname }),
);
