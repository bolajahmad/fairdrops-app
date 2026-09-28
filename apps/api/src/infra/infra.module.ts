import { Global, Module } from "@nestjs/common";
import { ChainClients } from "./chain-clients.service.js";
import { PrismaModule } from "./prisma.module.js";
import { RedisModule } from "./redis.module.js";

@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [ChainClients],
  exports: [ChainClients],
})
export class InfraModule {}
