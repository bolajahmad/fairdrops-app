import { z } from "zod";
import { chainSchema, deploymentEnvironmentSchema } from "./chains.js";

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 20-byte hex address");
export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte hex value");

export const contractNameSchema = z.enum(["FairDrops"]);
export type ContractName = z.infer<typeof contractNameSchema>;

/** One deployment as recorded in `packages/contracts/deployments/<chainId>.json`. */
export const contractDeploymentSchema = z.object({
  contract: contractNameSchema,
  version: z.string().min(1),
  chainId: z.number().int().positive(),
  address: addressSchema,
  transactionHash: bytes32Schema,
  blockNumber: z.number().int().nonnegative(),
  deployer: addressSchema,
  salt: bytes32Schema,
  /** SHA-256 of the ABI the deployed bytecode was compiled from. */
  abiHash: bytes32Schema,
  deployedAt: z.iso.datetime(),
});
export type ContractDeployment = z.infer<typeof contractDeploymentSchema>;

export const deployedContractSchema = contractDeploymentSchema.extend({
  chain: chainSchema,
  explorerUrl: z.url().nullable(),
  /** False when the deployment predates the ABI currently published by the API. */
  abiCurrent: z.boolean(),
});
export type DeployedContract = z.infer<typeof deployedContractSchema>;

export const environmentContractsResponseSchema = z.object({
  environment: deploymentEnvironmentSchema,
  abiHash: bytes32Schema,
  contracts: z.array(deployedContractSchema),
});
export type EnvironmentContractsResponse = z.infer<typeof environmentContractsResponseSchema>;

export const contractAbiResponseSchema = z.object({
  contract: contractNameSchema,
  abiHash: bytes32Schema,
  abi: z.array(z.record(z.string(), z.unknown())),
});
export type ContractAbiResponse = z.infer<typeof contractAbiResponseSchema>;
