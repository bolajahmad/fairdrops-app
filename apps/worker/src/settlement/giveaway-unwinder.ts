import { Inject, Injectable, Logger } from "@nestjs/common";
import { fairDropsAbi } from "@fairdrops/contracts";
import type { Address, Hex } from "@fairdrops/shared";
import { encodeFunctionData } from "viem";
import { FAIRDROPS_READER, type FairDropsReader } from "../chain/reader.js";
import { decodeRevert } from "../chain/rpc.js";
import { TxEngine } from "../chain/tx-engine.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { TERMINAL_STATUSES } from "../sessions/session-lifecycle.js";

/**
 * Cancels on-chain the giveaway of a game that ended without a result (nobody joined, nobody
 * qualified, the seed was never committed), so the host can withdraw the whole deposit, fee
 * included, right away instead of waiting for the finalize deadline.
 */
@Injectable()
export class GiveawayUnwinder {
  private readonly logger = new Logger(GiveawayUnwinder.name);

  constructor(
    @Inject(PRISMA) private readonly db: Database,
    @Inject(FAIRDROPS_READER) private readonly reader: FairDropsReader,
    private readonly engine: TxEngine,
  ) {}

  async cancel(sessionId: string): Promise<boolean> {
    const session = await this.db.gameSession.findUnique({
      where: { id: sessionId },
      include: { giveaway: true },
    });
    if (!session || session.status === "FINALIZED" || !TERMINAL_STATUSES.includes(session.status)) {
      return false;
    }
    const contract = session.giveaway.contractAddress as Address;
    const giveawayId = session.giveawayId as Hex;
    const onchain = await this.reader.giveaway(session.chainId, contract, giveawayId);
    if (onchain.status !== "Active") return false;

    try {
      const tx = await this.engine.send({
        chainId: session.chainId,
        kind: "CANCEL",
        ref: sessionId,
        sender: "operator",
        to: contract,
        data: encodeFunctionData({ abi: fairDropsAbi, functionName: "cancel", args: [giveawayId] }),
      });
      const settled = await this.engine.waitFor(tx.id);
      if (settled.status !== "MINED") return false;
      this.logger.log(
        `Session ${sessionId}: cancelled giveaway ${giveawayId} on ${session.chainId} ` +
          `(${session.failureReason}); the host can withdraw the refund`,
      );
      return true;
    } catch (error) {
      const revert = decodeRevert(error);
      if (revert?.errorName === "InvalidStatus") return false;
      throw error;
    }
  }
}
