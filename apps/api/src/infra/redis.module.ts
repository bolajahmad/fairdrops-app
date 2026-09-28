import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { API_ENV, type ApiEnv } from "../config/env.js";

export const REDIS = Symbol("REDIS");

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [API_ENV],
      // Connects on first command, so the API can boot while Redis is still starting.
      useFactory: (env: ApiEnv) =>
        new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === "ready") await this.redis.quit();
    else this.redis.disconnect();
  }
}
