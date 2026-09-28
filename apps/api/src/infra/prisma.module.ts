import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createPrismaClient } from "@fairdrops/db";
import { API_ENV, type ApiEnv } from "../config/env.js";

export const PRISMA = Symbol("PRISMA");

export type Database = ReturnType<typeof createPrismaClient>;

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): Database =>
        createPrismaClient({
          connectionString: env.DATABASE_URL,
          maxConnections: env.DATABASE_POOL_SIZE,
        }),
    },
  ],
  exports: [PRISMA],
})
export class PrismaModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$disconnect();
  }
}
