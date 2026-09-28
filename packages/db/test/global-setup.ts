import { DEFAULT_TEST_DATABASE_URL, prepareTestDatabase } from "../src/testing.js";

export default async function setup(): Promise<void> {
  process.env.TEST_DATABASE_URL ??= DEFAULT_TEST_DATABASE_URL;
  await prepareTestDatabase(process.env.TEST_DATABASE_URL);
}
