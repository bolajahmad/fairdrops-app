import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { PrismaClient } from "./generated/prisma/client.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://fairdrops:fairdrops@localhost:5432/fairdrops_test";

/**
 * Creates the test database if needed and applies every migration. Call once per test run,
 * from a Vitest global setup.
 */
export async function prepareTestDatabase(url: string = DEFAULT_TEST_DATABASE_URL): Promise<void> {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Refusing to create database "${name}"`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }

  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

/** Empties every application table, keeping the schema and migration history. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
