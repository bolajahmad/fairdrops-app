import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export * from "./generated/prisma/client.js";

export interface DatabaseOptions {
  connectionString: string;
  /** Maximum pool size. Defaults to the pg default of 10. */
  maxConnections?: number;
}

export function createPrismaClient({ connectionString, maxConnections }: DatabaseOptions) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: maxConnections }),
  });
}

/** Postgres error code for a unique constraint violation, as reported by Prisma. */
export const UNIQUE_VIOLATION = "P2002";
