import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// The CLI reads DATABASE_URL from the environment, falling back to the repository's .env.
const rootEnv = new URL("../../.env", import.meta.url);
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // `prisma generate` needs no database, so a missing URL only fails commands that connect.
    url: process.env.DATABASE_URL ?? "postgresql://unset@localhost:5432/unset",
  },
});
