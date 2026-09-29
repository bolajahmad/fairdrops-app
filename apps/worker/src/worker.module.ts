import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthService } from "./health/health.service.js";
import { IndexerModule } from "./indexer/indexer.module.js";
import { PrismaModule } from "./infra/prisma.module.js";
import { RedisModule } from "./infra/redis.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, IndexerModule, SessionsModule],
  providers: [HealthService],
  exports: [HealthService],
})
export class WorkerModule {}
