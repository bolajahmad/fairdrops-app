import "reflect-metadata";
import { existsSync } from "node:fs";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { HealthService } from "./health/health.service.js";
import { WorkerModule } from "./worker.module.js";

// Local development reads the repository's .env; real deployments set the environment directly.
const rootEnv = new URL("../../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const { version } = app.get(HealthService).check();
  Logger.log(`Worker started (version ${version})`, "Bootstrap");
}

await bootstrap();
