import type { ContractDeployment } from "@fairdrops/shared";

export const CONTRACT_DEPLOYMENTS = Symbol("CONTRACT_DEPLOYMENTS");
export const CONTRACT_ABI = Symbol("CONTRACT_ABI");

export type ContractDeployments = readonly ContractDeployment[];

export interface ContractAbi {
  abi: readonly Record<string, unknown>[];
  hash: string;
}
