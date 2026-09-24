import type { ContractDeployment, ContractName } from "@fairdrops/shared";
import { fairDropsAbi, fairDropsAbiHash } from "./generated/abi.js";
import { deployments } from "./generated/deployments.js";

export { deployments, fairDropsAbi, fairDropsAbiHash };

export function findDeployment(
  chainId: number,
  contract: ContractName = "FairDrops",
): ContractDeployment | undefined {
  return deployments.find((d) => d.chainId === chainId && d.contract === contract);
}
