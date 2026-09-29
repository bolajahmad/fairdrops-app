import { Inject, Injectable } from "@nestjs/common";
import { fairDropsAbi } from "@fairdrops/contracts";
import { findChain, type Address, type Hex } from "@fairdrops/shared";
import {
  BaseError,
  ContractFunctionRevertedError,
  TransactionReceiptNotFoundError,
  createPublicClient,
  decodeErrorResult,
  defineChain,
  fallback,
  http,
  type Chain,
  type PublicClient,
} from "viem";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";

const RPC_TIMEOUT_MS = 15_000;

export interface CallRequest {
  from: Address;
  to: Address;
  data: Hex;
  value?: bigint;
}

export type FeeQuote =
  | { type: "eip1559"; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { type: "legacy"; gasPrice: bigint };

export interface Receipt {
  hash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
}

/**
 * The contract refused the call, with the custom error it reverted with (for example
 * `InvalidStatus` or `TooLate`). Retrying the same call cannot succeed.
 */
export class ContractRevert extends Error {
  constructor(
    readonly errorName: string,
    readonly args: readonly unknown[] = [],
  ) {
    super(`Reverted with ${errorName}(${args.map(String).join(", ")})`);
    this.name = "ContractRevert";
  }
}

/**
 * The JSON-RPC calls the worker makes to send transactions and follow them. Kept this narrow so
 * tests can stand in for a chain without one.
 */
export interface ChainRpc {
  readonly chainId: number;
  readonly chain: Chain;
  pendingNonce(address: Address): Promise<number>;
  latestNonce(address: Address): Promise<number>;
  blockNumber(): Promise<bigint>;
  fees(): Promise<FeeQuote>;
  /** Throws ContractRevert when the call would revert. */
  estimateGas(call: CallRequest): Promise<bigint>;
  /** Throws ContractRevert when the call would revert. */
  simulate(call: CallRequest): Promise<void>;
  sendRawTransaction(raw: Hex): Promise<Hex>;
  receipt(hash: Hex): Promise<Receipt | null>;
  balance(address: Address): Promise<bigint>;
  /** Reads from the FairDrops contract. */
  read<T>(contract: Address, functionName: string, args: readonly unknown[]): Promise<T>;
}

export const CHAIN_RPC = Symbol("CHAIN_RPC");
export type ChainRpcFactory = (chainId: number) => ChainRpc;

/** Finds a custom error from the FairDrops ABI anywhere in a viem error chain. */
export function decodeRevert(error: unknown): ContractRevert | null {
  if (error instanceof ContractRevert) return error;
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError && reverted.data) {
    return new ContractRevert(reverted.data.errorName, reverted.data.args ?? []);
  }
  const withData = error.walk(
    (e) =>
      typeof (e as { data?: unknown }).data === "string" &&
      (e as { data: string }).data.length >= 10,
  ) as { data?: Hex } | null;
  if (withData?.data) {
    try {
      const decoded = decodeErrorResult({ abi: fairDropsAbi, data: withData.data });
      return new ContractRevert(decoded.errorName, decoded.args ?? []);
    } catch {
      return null;
    }
  }
  return null;
}

function rethrow(error: unknown): never {
  throw decodeRevert(error) ?? error;
}

class ViemChainRpc implements ChainRpc {
  constructor(
    readonly chain: Chain,
    private readonly client: PublicClient,
  ) {}

  get chainId(): number {
    return this.chain.id;
  }

  pendingNonce(address: Address): Promise<number> {
    return this.client.getTransactionCount({ address, blockTag: "pending" });
  }

  latestNonce(address: Address): Promise<number> {
    return this.client.getTransactionCount({ address, blockTag: "latest" });
  }

  blockNumber(): Promise<bigint> {
    return this.client.getBlockNumber({ cacheTime: 0 });
  }

  async fees(): Promise<FeeQuote> {
    try {
      const fees = await this.client.estimateFeesPerGas({ chain: this.chain, type: "eip1559" });
      return { type: "eip1559", ...fees };
    } catch {
      return { type: "legacy", gasPrice: await this.client.getGasPrice() };
    }
  }

  estimateGas(call: CallRequest): Promise<bigint> {
    return this.client
      .estimateGas({ account: call.from, to: call.to, data: call.data, value: call.value })
      .catch(rethrow);
  }

  async simulate(call: CallRequest): Promise<void> {
    await this.client
      .call({ account: call.from, to: call.to, data: call.data, value: call.value })
      .catch(rethrow);
  }

  sendRawTransaction(raw: Hex): Promise<Hex> {
    return this.client.sendRawTransaction({ serializedTransaction: raw });
  }

  async receipt(hash: Hex): Promise<Receipt | null> {
    try {
      const receipt = await this.client.getTransactionReceipt({ hash });
      return { hash, status: receipt.status, blockNumber: receipt.blockNumber };
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  }

  balance(address: Address): Promise<bigint> {
    return this.client.getBalance({ address });
  }

  read<T>(contract: Address, functionName: string, args: readonly unknown[]): Promise<T> {
    return this.client.readContract({
      address: contract,
      abi: fairDropsAbi,
      functionName: functionName as never,
      args: args,
    });
  }
}

/**
 * One RPC client per chain, over every endpoint configured for it: RPC_URLS first, then the
 * registry's public ones, falling back to the next when one fails.
 */
@Injectable()
export class ChainRpcs {
  private readonly rpcs = new Map<number, ChainRpc>();

  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {}

  get(chainId: number): ChainRpc {
    const existing = this.rpcs.get(chainId);
    if (existing) return existing;
    const entry = findChain(chainId);
    if (!entry) throw new Error(`Chain ${chainId} is not in the registry`);

    const urls = [...(this.env.RPC_URLS.get(chainId) ?? []), ...entry.rpcUrls];
    const chain = defineChain({
      id: entry.chainId,
      name: entry.name,
      nativeCurrency: entry.nativeCurrency,
      rpcUrls: { default: { http: urls } },
    });
    const transport = fallback(
      urls.map((url) => http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 1 })),
      { rank: false },
    );
    const rpc = new ViemChainRpc(chain, createPublicClient({ chain, transport }));
    this.rpcs.set(chainId, rpc);
    return rpc;
  }
}
