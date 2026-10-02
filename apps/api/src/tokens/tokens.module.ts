import { Module } from "@nestjs/common";
import { ChainTokenReader, TOKEN_READER } from "./token-reader.js";
import { TokensController } from "./tokens.controller.js";
import { TokensService } from "./tokens.service.js";

@Module({
  controllers: [TokensController],
  providers: [TokensService, { provide: TOKEN_READER, useClass: ChainTokenReader }],
  exports: [TokensService],
})
export class TokensModule {}
