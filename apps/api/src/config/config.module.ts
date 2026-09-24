import { Global, Module } from "@nestjs/common";
import { API_ENV, parseApiEnv } from "./env.js";

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: () => parseApiEnv(process.env) }],
  exports: [API_ENV],
})
export class ConfigModule {}
