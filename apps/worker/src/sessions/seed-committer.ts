import { Inject, Injectable, Logger } from "@nestjs/common";
import { fairDropsAbi } from "@fairdrops/contracts";
import { findChain, type Address, type Hex } from "@fairdrops/shared";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PrivateKeyAccount,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const RPC_TIMEOUT_MS = 15_000;
const RECEIPT_TIMEOUT_MS = 180_000;

export interface SeedCommitRequest {
  chainId: number;
  contract: Address;
  giveawayId: Hex;
  commitment: Hex;
}

/** Commits a session's seed with `commitSeed`, the operator's only on-chain duty before play. */
export interface SeedCommitter {
  /**
   * Resolves once the commitment is on-chain, with the transaction hash, or null when it was
   * already there (a retry after a crash). Throws SeedCommitConflict if a different commitment
   * is on-chain, which retrying cannot fix.
   */
  commit(request: SeedCommitRequest): Promise<Hex | null>;
}

export const SEED_COMMITTER = Symbol("SEED_COMMITTER");

export class SeedCommitConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedCommitConflict";
  }
}

@Injectable()
export class OnchainSeedCommitter implements SeedCommitter {
  private readonly logger = new Logger(OnchainSeedCommitter.name);
  private readonly account: PrivateKeyAccount | null;
  private readonly chains = new Map<number, Chain>();

  constructor(@Inject(WORKER_ENV) env: WorkerEnv) {
    const key = env.OPERATOR_PRIVATE_KEY;
    // The nonce manager hands out nonces locally, so commits for several sessions queued in the
    // same process do not reuse one.
    this.account = key
      ? privateKeyToAccount(key.startsWith("0x") ? (key as Hex) : `0x${key}`, { nonceManager })
      : null;
    if (!this.account && env.SESSIONS_ENABLED) {
      this.logger.warn(
        "OPERATOR_PRIVATE_KEY is not set; seeds cannot be committed, so sessions will fail at the start",
      );
    }
  }

  async commit({
    chainId,
    contract,
    giveawayId,
    commitment,
  }: SeedCommitRequest): Promise<Hex | null> {
    if (!this.account) throw new Error("OPERATOR_PRIVATE_KEY is not set");
    const chain = this.chain(chainId);
    const transport = http(undefined, { timeout: RPC_TIMEOUT_MS, retryCount: 2 });
    const reader = createPublicClient({ chain, transport });

    const onchain = await reader.readContract({
      address: contract,
      abi: fairDropsAbi,
      functionName: "getGiveaway",
      args: [giveawayId],
    });
    if (onchain.seedCommitment === commitment) return null;
    if (onchain.seedCommitment !== ZERO_HASH) {
      throw new SeedCommitConflict(
        `Giveaway ${giveawayId} already has commitment ${onchain.seedCommitment}`,
      );
    }

    const writer = createWalletClient({ account: this.account, chain, transport });
    const { request } = await reader.simulateContract({
      account: this.account,
      address: contract,
      abi: fairDropsAbi,
      functionName: "commitSeed",
      args: [giveawayId, commitment],
    });
    const hash = await writer.writeContract(request);
    const receipt = await reader.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success") throw new Error(`commitSeed transaction ${hash} reverted`);
    return hash;
  }

  private chain(chainId: number): Chain {
    const existing = this.chains.get(chainId);
    if (existing) return existing;
    const entry = findChain(chainId);
    if (!entry) throw new Error(`Chain ${chainId} is not in the registry`);
    const chain = defineChain({
      id: entry.chainId,
      name: entry.name,
      nativeCurrency: entry.nativeCurrency,
      rpcUrls: { default: { http: entry.rpcUrls } },
    });
    this.chains.set(chainId, chain);
    return chain;
  }
}
