import { Inject, Injectable, Logger } from "@nestjs/common";
import { fairDropsAbi } from "@fairdrops/contracts";
import type { Address, Hex } from "@fairdrops/shared";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { FAIRDROPS_READER, type FairDropsReader } from "../chain/reader.js";
import { decodeRevert } from "../chain/rpc.js";
import { TxEngine } from "../chain/tx-engine.js";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";

interface Claim {
  account: Address;
  amount: bigint;
  proof: Hex[];
}

/**
 * Claims prizes on winners' behalf with `claimMany`, paying the gas, so a winner who signed in
 * with email and holds no native currency still gets paid. Prizes go to each winner (or their
 * payout wallet); the relayer only pays for the transaction.
 */
@Injectable()
export class ClaimRelayer {
  private readonly logger = new Logger(ClaimRelayer.name);

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) private readonly db: Database,
    @Inject(FAIRDROPS_READER) private readonly reader: FairDropsReader,
    private readonly engine: TxEngine,
  ) {}

  /** Claims every unclaimed payout of a finalized session. Returns how many were claimed. */
  async relay(sessionId: string, now = new Date()): Promise<number> {
    const settlement = await this.db.settlement.findUnique({
      where: { sessionId },
      include: {
        payouts: { where: { claimedAt: null }, orderBy: { rank: "asc" } },
        session: { include: { giveaway: true } },
      },
    });
    if (!settlement || settlement.status !== "CONFIRMED") return 0;
    const { giveaway } = settlement.session;
    if (!giveaway.claimDeadline || giveaway.claimDeadline <= now) return 0;
    const contract = giveaway.contractAddress as Address;
    const giveawayId = settlement.giveawayId as Hex;

    // The indexed claims lag the chain; ask the chain which are still open.
    const open: Claim[] = [];
    for (const payout of settlement.payouts) {
      const account = payout.account as Address;
      if (await this.reader.isClaimed(settlement.chainId, contract, giveawayId, account)) continue;
      open.push({
        account,
        amount: BigInt(payout.amount.toFixed()),
        proof: payout.proof as Hex[],
      });
    }

    let claimed = 0;
    for (let i = 0; i < open.length; i += this.env.CLAIM_BATCH_SIZE) {
      const batch = open.slice(i, i + this.env.CLAIM_BATCH_SIZE);
      claimed += await this.send(settlement.chainId, contract, giveawayId, sessionId, batch);
    }
    return claimed;
  }

  /**
   * Sends one batch. One bad claim reverts the whole batch, so a batch that would revert is split
   * in half until the claim that fails is on its own, and that one is skipped.
   */
  private async send(
    chainId: number,
    contract: Address,
    giveawayId: Hex,
    sessionId: string,
    batch: Claim[],
  ): Promise<number> {
    const accounts = batch.map((claim) => claim.account).join(",");
    try {
      const tx = await this.engine.send({
        chainId,
        kind: "CLAIM",
        ref: `${sessionId}:${keccak256(toHex(accounts)).slice(2, 18)}`,
        sender: "relayer",
        to: contract,
        data: encodeFunctionData({
          abi: fairDropsAbi,
          functionName: "claimMany",
          args: [
            batch.map((claim) => ({
              id: giveawayId,
              account: claim.account,
              amount: claim.amount,
              proof: claim.proof,
            })),
          ],
        }),
      });
      const settled = await this.engine.waitFor(tx.id);
      if (settled.status === "MINED") {
        this.logger.log(
          `Session ${sessionId}: relayed ${batch.length} claims in ${settled.minedHash}`,
        );
        return batch.length;
      }
      return 0;
    } catch (error) {
      const revert = decodeRevert(error);
      if (!revert) throw error;
      if (batch.length === 1) {
        this.logger.warn(
          `Session ${sessionId}: cannot claim for ${batch[0]!.account}: ${revert.errorName}`,
        );
        return 0;
      }
      const half = Math.ceil(batch.length / 2);
      return (
        (await this.send(chainId, contract, giveawayId, sessionId, batch.slice(0, half))) +
        (await this.send(chainId, contract, giveawayId, sessionId, batch.slice(half)))
      );
    }
  }
}
