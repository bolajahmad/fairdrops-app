import { Inject, Injectable, Logger } from "@nestjs/common";
import { fairDropsAbi } from "@fairdrops/contracts";
import { sortSettlementSignatures, type SettlementMessage } from "@fairdrops/settlement";
import type { Address, Hex } from "@fairdrops/shared";
import { encodeFunctionData } from "viem";
import { FAIRDROPS_READER, type FairDropsReader } from "../chain/reader.js";
import { decodeRevert } from "../chain/rpc.js";
import { TxEngine } from "../chain/tx-engine.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { SessionLifecycle } from "../sessions/session-lifecycle.js";

/** Reverts that mean this settlement can never be finalized. */
const FATAL = new Set([
  "TooLate",
  "SeedMismatch",
  "SeedNotCommitted",
  "InvalidSettlement",
  "PayoutExceedsPrize",
]);
/** Reverts that mean the signatures no longer satisfy the contract; verifiers sign again. */
const RESIGN = new Set(["InsufficientSignatures", "UnauthorizedSigner", "SignersNotSorted"]);

export type SubmitOutcome = "submitted" | "mined" | "reverted" | "skipped" | "abandoned";

/**
 * Sends `finalize` with the verifier signatures. Anyone may submit a signed settlement, so the
 * outcome is confirmed from the indexed GiveawayFinalized event, not from this transaction.
 */
@Injectable()
export class SettlementSubmitter {
  private readonly logger = new Logger(SettlementSubmitter.name);

  constructor(
    @Inject(PRISMA) private readonly db: Database,
    @Inject(FAIRDROPS_READER) private readonly reader: FairDropsReader,
    private readonly engine: TxEngine,
    private readonly lifecycle: SessionLifecycle,
  ) {}

  async submit(sessionId: string): Promise<SubmitOutcome> {
    const settlement = await this.db.settlement.findUnique({
      where: { sessionId },
      include: { signatures: true, session: { include: { giveaway: true } } },
    });
    if (!settlement || settlement.status !== "SIGNED") return "skipped";
    const chainId = settlement.chainId;
    const contract = settlement.session.giveaway.contractAddress as Address;
    const giveawayId = settlement.giveawayId as Hex;
    const message: SettlementMessage = {
      giveawayId,
      payoutRoot: settlement.payoutRoot as Hex,
      totalPayout: BigInt(settlement.totalPayout.toFixed()),
      winnerCount: settlement.winnerCount,
      seed: settlement.seed as Hex,
      transcriptHash: settlement.transcriptHash as Hex,
    };

    // Only signatures from keys that still hold the role, in the order the contract requires.
    const current: Hex[] = [];
    for (const signature of settlement.signatures) {
      if (await this.reader.isVerifier(chainId, contract, signature.verifier as Address)) {
        current.push(signature.signature as Hex);
      }
    }
    const sorted = await sortSettlementSignatures(chainId, contract, message, current);

    let tx;
    try {
      tx = await this.engine.send({
        chainId,
        kind: "FINALIZE",
        ref: sessionId,
        sender: "relayer",
        to: contract,
        data: encodeFunctionData({
          abi: fairDropsAbi,
          functionName: "finalize",
          args: [
            giveawayId,
            {
              payoutRoot: message.payoutRoot,
              totalPayout: message.totalPayout,
              winnerCount: message.winnerCount,
              seed: message.seed,
              transcriptHash: message.transcriptHash,
            },
            sorted.map((s) => s.signature),
          ],
        }),
      });
    } catch (error) {
      const revert = decodeRevert(error);
      if (!revert) throw error;
      if (FATAL.has(revert.errorName)) {
        await this.abandon(sessionId, `finalize reverts with ${revert.errorName}`);
        return "abandoned";
      }
      if (RESIGN.has(revert.errorName)) {
        this.logger.error(
          `Session ${sessionId}: finalize reverts with ${revert.errorName}; collecting signatures again`,
        );
        await this.db.$transaction([
          this.db.settlementSignature.deleteMany({ where: { sessionId } }),
          this.db.settlement.updateMany({
            where: { sessionId, status: "SIGNED" },
            data: { status: "PROPOSED" },
          }),
        ]);
        return "skipped";
      }
      // InvalidStatus (already finalized, cancelled or expired), TooEarly or a pause: the
      // reconciler acts on the indexed state, or a later pass retries.
      this.logger.warn(`Session ${sessionId}: finalize would revert with ${revert.errorName}`);
      return "skipped";
    }

    const { count } = await this.db.settlement.updateMany({
      where: { sessionId, status: "SIGNED" },
      data: { status: "SUBMITTED", finalizeTxId: tx.id },
    });
    if (count === 1) await this.lifecycle.finalizing(sessionId);

    const settled = await this.engine.waitFor(tx.id);
    if (settled.status === "MINED") {
      this.logger.log(`Session ${sessionId}: finalize mined in ${settled.minedHash}`);
      return "mined";
    }
    if (settled.status === "SIGNED" || settled.status === "SENT") return "submitted";
    await this.retry(sessionId, tx.id);
    return "reverted";
  }

  /** After a failed finalize transaction, lets the next pass send another. */
  async retry(sessionId: string, txId: string): Promise<void> {
    const { count } = await this.db.settlement.updateMany({
      where: { sessionId, status: "SUBMITTED", finalizeTxId: txId },
      data: { status: "SIGNED", finalizeTxId: null },
    });
    if (count === 1) this.logger.warn(`Session ${sessionId}: finalize did not land; will resend`);
  }

  /** Gives up on a settlement that can never be finalized, and fails its session. */
  async abandon(sessionId: string, reason: string): Promise<void> {
    await this.db.settlement.updateMany({
      where: { sessionId, status: { notIn: ["CONFIRMED", "ABANDONED"] } },
      data: { status: "ABANDONED", failureReason: reason },
    });
    await this.lifecycle.fail(sessionId, ["SETTLING", "FINALIZING"], reason);
  }
}
