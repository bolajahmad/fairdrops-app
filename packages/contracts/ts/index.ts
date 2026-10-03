import type { ContractDeployment, ContractName } from "@fairdrops/shared";
import { fairDropsAbi, fairDropsAbiHash } from "./generated/abi.js";
import { fairDropsAccountAbi } from "./generated/account-abi.js";
import { deployments } from "./generated/deployments.js";

export { deployments, fairDropsAbi, fairDropsAbiHash, fairDropsAccountAbi };

/**
 * FairDropsAccount, the EIP-7702 delegate embedded wallets use to act without gas. Deployed
 * through CREATE2 with no configuration (script/DeployAccount.s.sol), so it has this address on
 * every chain FairDrops runs on.
 */
export const FAIRDROPS_ACCOUNT_ADDRESS = "0xec34809c2b93ca8bd3ffc66d134b3d167f6c2f98" as const;

export function findDeployment(
  chainId: number,
  contract: ContractName = "FairDrops",
): ContractDeployment | undefined {
  return deployments.find((d) => d.chainId === chainId && d.contract === contract);
}
