import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { HealthService } from "./health/health.service.js";
import { WorkerModule } from "./worker.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const { version } = app.get(HealthService).check();
  Logger.log(`Worker started (version ${version})`, "Bootstrap");
}

await bootstrap();
