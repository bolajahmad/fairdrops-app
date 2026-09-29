import { Module } from "@nestjs/common";
import { ChainModule } from "./chain/chain.module.js";
import { ConfigModule } from "./config/config.module.js";
import { HealthService } from "./health/health.service.js";
import { IndexerModule } from "./indexer/indexer.module.js";
import { PrismaModule } from "./infra/prisma.module.js";
import { RedisModule } from "./infra/redis.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import { SettlementModule } from "./settlement/settlement.module.js";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    ChainModule,
    IndexerModule,
    SessionsModule,
    SettlementModule,
  ],
  providers: [HealthService],
  exports: [HealthService],
})
export class WorkerModule {}
