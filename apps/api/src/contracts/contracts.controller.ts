import { Controller, Get, Header, NotFoundException, Param } from "@nestjs/common";
import {
  deploymentEnvironmentSchema,
  type ContractAbiResponse,
  type DeployedContract,
  type DeploymentEnvironment,
  type EnvironmentContractsResponse,
} from "@fairdrops/shared";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ContractsService } from "./contracts.service.js";

const chainIdSchema = z.coerce.number().int().positive();

// Deployments only change with a new API build, so clients may cache briefly.
const CACHE_CONTROL = "public, max-age=300";

@Controller("contracts")
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  /** Deployments for the environment this API instance serves. */
  @Get()
  @Header("Cache-Control", CACHE_CONTROL)
  current(): EnvironmentContractsResponse {
    return this.contracts.forEnvironment(this.contracts.defaultEnvironment);
  }

  @Get("abi")
  @Header("Cache-Control", CACHE_CONTROL)
  abi(): ContractAbiResponse {
    return this.contracts.currentAbi();
  }

  @Get(":environment")
  @Header("Cache-Control", CACHE_CONTROL)
  byEnvironment(
    @Param("environment", new ZodValidationPipe(deploymentEnvironmentSchema))
    environment: DeploymentEnvironment,
  ): EnvironmentContractsResponse {
    return this.contracts.forEnvironment(environment);
  }

  @Get(":environment/:chainId")
  @Header("Cache-Control", CACHE_CONTROL)
  byChain(
    @Param("environment", new ZodValidationPipe(deploymentEnvironmentSchema))
    environment: DeploymentEnvironment,
    @Param("chainId", new ZodValidationPipe(chainIdSchema)) chainId: number,
  ): DeployedContract {
    const deployment = this.contracts.forChain(environment, chainId);
    if (!deployment) {
      throw new NotFoundException(`No FairDrops deployment on chain ${chainId} in ${environment}`);
    }
    return deployment;
  }
}
