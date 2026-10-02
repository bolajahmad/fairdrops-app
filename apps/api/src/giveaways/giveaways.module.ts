import { Module } from "@nestjs/common";
import {
  ClaimsController,
  GiveawaysController,
  SettlementsController,
} from "./giveaways.controller.js";
import { GiveawaysService } from "./giveaways.service.js";
import { TokensModule } from "../tokens/tokens.module.js";

@Module({
  imports: [TokensModule],
  controllers: [GiveawaysController, SettlementsController, ClaimsController],
  providers: [GiveawaysService],
})
export class GiveawaysModule {}
