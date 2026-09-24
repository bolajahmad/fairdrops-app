import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { ContractsModule } from "./contracts/contracts.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [ConfigModule, HealthModule, ContractsModule],
})
export class AppModule {}
