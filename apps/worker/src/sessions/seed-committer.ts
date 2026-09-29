import { Inject, Injectable, Logger } from "@nestjs/common";
import { fairDropsAbi } from "@fairdrops/contracts";
import type { Address, Hex } from "@fairdrops/shared";
import { encodeFunctionData } from "viem";
import { Keyring } from "../chain/keyring.js";
import { FAIRDROPS_READER, type FairDropsReader } from "../chain/reader.js";
import { decodeRevert } from "../chain/rpc.js";
import { TxEngine } from "../chain/tx-engine.js";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";

const ZERO_HASH = `0x${"0".repeat(64)}`;

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

/**
 * Commits through the transaction engine, so the commit is recorded before it is broadcast and a
 * retry after a crash follows the transaction already sent instead of sending another.
 */
@Injectable()
export class OnchainSeedCommitter implements SeedCommitter {
  private readonly logger = new Logger(OnchainSeedCommitter.name);

  constructor(
    @Inject(WORKER_ENV) env: WorkerEnv,
    @Inject(FAIRDROPS_READER) private readonly reader: FairDropsReader,
    private readonly engine: TxEngine,
    keyring: Keyring,
  ) {
    if (!keyring.operator && env.SESSIONS_ENABLED) {
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
    const onchain = await this.reader.giveaway(chainId, contract, giveawayId);
    if (onchain.seedCommitment === commitment) {
      const sent = await this.engine.latest("COMMIT_SEED", `${chainId}:${giveawayId}`);
      return sent?.status === "MINED" ? (sent.minedHash as Hex) : null;
    }
    if (onchain.seedCommitment !== ZERO_HASH) {
      throw new SeedCommitConflict(
        `Giveaway ${giveawayId} already has commitment ${onchain.seedCommitment}`,
      );
    }

    let tx;
    try {
      tx = await this.engine.send({
        chainId,
        kind: "COMMIT_SEED",
        ref: `${chainId}:${giveawayId}`,
        sender: "operator",
        to: contract,
        data: encodeFunctionData({
          abi: fairDropsAbi,
          functionName: "commitSeed",
          args: [giveawayId, commitment],
        }),
      });
    } catch (error) {
      const revert = decodeRevert(error);
      if (revert?.errorName === "SeedAlreadyCommitted") {
        return this.commit({ chainId, contract, giveawayId, commitment });
      }
      throw error;
    }

    const settled = await this.engine.waitFor(tx.id);
    if (settled.status === "MINED") return settled.minedHash as Hex;
    if (settled.status === "REVERTED") throw new Error(`commitSeed ${settled.minedHash} reverted`);
    // Still in flight, or dropped: the job retries, following or replacing the transaction.
    throw new Error(`commitSeed for ${giveawayId} is ${settled.status.toLowerCase()}`);
  }
}
