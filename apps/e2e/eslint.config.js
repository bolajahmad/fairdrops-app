import { createBaseConfig } from "@fairdrops/config/eslint/base";

export default [
  ...createBaseConfig({ tsconfigRootDir: import.meta.dirname }),
  // A command-line runner: its output is the report.
  { files: ["src/**/*.ts"], rules: { "no-console": "off" } },
];
