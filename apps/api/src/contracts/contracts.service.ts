import { Inject, Injectable } from "@nestjs/common";
import {
  explorerAddressUrl,
  findChain,
  type ContractAbiResponse,
  type DeployedContract,
  type DeploymentEnvironment,
  type EnvironmentContractsResponse,
} from "@fairdrops/shared";
import { API_ENV, type ApiEnv } from "../config/env.js";
import {
  CONTRACT_ABI,
  CONTRACT_DEPLOYMENTS,
  type ContractAbi,
  type ContractDeployments,
} from "./contracts.tokens.js";

@Injectable()
export class ContractsService {
  private readonly byEnvironment = new Map<DeploymentEnvironment, DeployedContract[]>();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(CONTRACT_DEPLOYMENTS) deployments: ContractDeployments,
    @Inject(CONTRACT_ABI) private readonly abi: ContractAbi,
  ) {
    // Deployments are fixed at build time, so they are resolved against the registry once.
    for (const deployment of deployments) {
      const chain = findChain(deployment.chainId);
      if (!chain) {
        throw new Error(`Deployment on chain ${deployment.chainId} has no registry entry`);
      }
      const list = this.byEnvironment.get(chain.environment) ?? [];
      list.push({
        ...deployment,
        chain,
        explorerUrl: explorerAddressUrl(chain, deployment.address),
        abiCurrent: deployment.abiHash === abi.hash,
      });
      this.byEnvironment.set(chain.environment, list);
    }
  }

  get defaultEnvironment(): DeploymentEnvironment {
    return this.env.DEPLOYMENT_ENVIRONMENT;
  }

  forEnvironment(environment: DeploymentEnvironment): EnvironmentContractsResponse {
    return {
      environment,
      abiHash: this.abi.hash,
      contracts: this.byEnvironment.get(environment) ?? [],
    };
  }

  forChain(environment: DeploymentEnvironment, chainId: number): DeployedContract | undefined {
    return this.byEnvironment.get(environment)?.find((d) => d.chainId === chainId);
  }

  currentAbi(): ContractAbiResponse {
    return { contract: "FairDrops", abiHash: this.abi.hash, abi: [...this.abi.abi] };
  }
}
