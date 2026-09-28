import { DEFAULT_TEST_DATABASE_URL } from "@fairdrops/db/testing";

/**
 * The worker's own test database. Turbo runs each package's tests in parallel, and every
 * integration suite empties its database between cases, so packages must not share one.
 */
export function workerTestDatabaseUrl(): string {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
  url.pathname = `${url.pathname}_worker`;
  return url.toString();
}
