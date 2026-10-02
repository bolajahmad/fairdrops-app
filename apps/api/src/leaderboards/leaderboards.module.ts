import { Module } from "@nestjs/common";
import { PricesModule } from "../prices/prices.module.js";
import { TokensModule } from "../tokens/tokens.module.js";
import { LeaderboardsController } from "./leaderboards.controller.js";
import { LeaderboardsService } from "./leaderboards.service.js";

@Module({
  imports: [TokensModule, PricesModule],
  controllers: [LeaderboardsController],
  providers: [LeaderboardsService],
})
export class LeaderboardsModule {}
