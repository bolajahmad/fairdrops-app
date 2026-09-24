import { Global, Module } from "@nestjs/common";
import { WORKER_ENV, parseWorkerEnv } from "./env.js";

@Global()
@Module({
  providers: [{ provide: WORKER_ENV, useFactory: () => parseWorkerEnv(process.env) }],
  exports: [WORKER_ENV],
})
export class ConfigModule {}
