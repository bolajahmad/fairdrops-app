import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthService } from "./health/health.service.js";

@Module({
  imports: [ConfigModule],
  providers: [HealthService],
  exports: [HealthService],
})
export class WorkerModule {}
