import { Module } from "@nestjs/common";
import { CoinGeckoPriceSource, PRICE_SOURCE } from "./price-source.js";
import { PricesController } from "./prices.controller.js";
import { PricesService } from "./prices.service.js";

@Module({
  controllers: [PricesController],
  providers: [PricesService, { provide: PRICE_SOURCE, useClass: CoinGeckoPriceSource }],
  exports: [PricesService],
})
export class PricesModule {}
