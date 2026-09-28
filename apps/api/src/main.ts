import "reflect-metadata";
import { existsSync } from "node:fs";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";
import { API_ENV, type ApiEnv } from "./config/env.js";

// Local development reads the repository's .env; real deployments set the environment directly.
const rootEnv = new URL("../../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const env = app.get<ApiEnv>(API_ENV);
  configureApp(app, env);

  await app.listen(env.API_PORT);
  Logger.log(`API listening on port ${env.API_PORT}`, "Bootstrap");
}

await bootstrap();
