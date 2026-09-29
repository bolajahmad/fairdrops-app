import { Module } from "@nestjs/common";
import {
  ClaimsController,
  GiveawaysController,
  SettlementsController,
} from "./giveaways.controller.js";
import { GiveawaysService } from "./giveaways.service.js";

@Module({
  controllers: [GiveawaysController, SettlementsController, ClaimsController],
  providers: [GiveawaysService],
})
export class GiveawaysModule {}
