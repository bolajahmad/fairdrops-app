import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { API_ENV, type ApiEnv } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const env = app.get<ApiEnv>(API_ENV);
  await app.listen(env.API_PORT);
  Logger.log(`API listening on port ${env.API_PORT}`, "Bootstrap");
}

await bootstrap();
