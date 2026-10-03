import { Module } from "@nestjs/common";
import { PricesModule } from "../prices/prices.module.js";
import { TokensModule } from "../tokens/tokens.module.js";
import { ChainRelayReader, RELAY_CHAIN } from "./relay-chain.js";
import { RelayController } from "./relay.controller.js";
import { RelayService } from "./relay.service.js";

@Module({
  imports: [TokensModule, PricesModule],
  controllers: [RelayController],
  providers: [RelayService, { provide: RELAY_CHAIN, useClass: ChainRelayReader }],
})
export class RelayModule {}
