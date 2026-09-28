import { DEFAULT_TEST_DATABASE_URL, prepareTestDatabase } from "@fairdrops/db/testing";

export default async function setup(): Promise<void> {
  await prepareTestDatabase(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
}
