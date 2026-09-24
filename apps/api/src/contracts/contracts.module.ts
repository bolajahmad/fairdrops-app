import { Module } from "@nestjs/common";
import { deployments, fairDropsAbi, fairDropsAbiHash } from "@fairdrops/contracts";
import { ContractsController } from "./contracts.controller.js";
import { ContractsService } from "./contracts.service.js";
import { CONTRACT_ABI, CONTRACT_DEPLOYMENTS, type ContractAbi } from "./contracts.tokens.js";

@Module({
  controllers: [ContractsController],
  providers: [
    ContractsService,
    { provide: CONTRACT_DEPLOYMENTS, useValue: deployments },
    {
      provide: CONTRACT_ABI,
      useValue: { abi: fairDropsAbi, hash: fairDropsAbiHash } satisfies ContractAbi,
    },
  ],
})
export class ContractsModule {}
