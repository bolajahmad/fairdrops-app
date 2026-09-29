import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";

export const REDIS = Symbol("REDIS");

/** Commands and publishing. Blocking reads use their own connections (see SessionOwner). */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [WORKER_ENV],
      useFactory: (env: WorkerEnv) =>
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
