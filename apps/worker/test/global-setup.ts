import { prepareTestDatabase } from "@fairdrops/db/testing";
import { workerTestDatabaseUrl } from "./database.js";

export default async function setup(): Promise<void> {
  await prepareTestDatabase(workerTestDatabaseUrl());
}
