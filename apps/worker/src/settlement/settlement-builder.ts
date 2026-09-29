import { Inject, Injectable, Logger } from "@nestjs/common";
import { UNIQUE_VIOLATION, Prisma } from "@fairdrops/db";
import {
  computeSettlement,
  settlementDigest,
  settlementMessage,
  type RankedPlayer,
} from "@fairdrops/settlement";
import {
  giveawayMetadataSchema,
  rewardPolicyOf,
  rewardPolicyProblem,
  type Address,
  type Hex,
} from "@fairdrops/shared";
import { FAIRDROPS_READER, type FairDropsReader } from "../chain/reader.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { SessionLifecycle } from "../sessions/session-lifecycle.js";

export type BuildOutcome = "built" | "skipped" | "failed" | "waiting";

/**
 * Turns a settled game into a settlement proposal: the payouts under the host's reward policy,
 * their Merkle tree and the digest verifiers will sign. The prize and the seed commitment are
 * read from the chain, not from the indexed copy.
 */
@Injectable()
export class SettlementBuilder {
  private readonly logger = new Logger(SettlementBuilder.name);

  constructor(
    @Inject(PRISMA) private readonly db: Database,
    @Inject(FAIRDROPS_READER) private readonly reader: FairDropsReader,
    private readonly lifecycle: SessionLifecycle,
  ) {}

  async build(sessionId: string): Promise<BuildOutcome> {
    const session = await this.db.gameSession.findUnique({
      where: { id: sessionId },
      include: { giveaway: true, settlement: { select: { sessionId: true } } },
    });
    if (!session || session.status !== "SETTLING" || session.settlement) return "skipped";
    const { giveaway } = session;
    const contract = giveaway.contractAddress as Address;
    const giveawayId = session.giveawayId as Hex;
    const fail = async (reason: string): Promise<BuildOutcome> => {
      await this.lifecycle.fail(sessionId, ["SETTLING"], reason);
      return "failed";
    };

    const metadata = giveawayMetadataSchema.safeParse(giveaway.metadata);
    if (!metadata.success) return fail("The giveaway's metadata is invalid");
    const policy = rewardPolicyOf(metadata.data, giveaway.maxWinners);
    const problem = rewardPolicyProblem(policy, giveaway.maxWinners);
    if (problem) return fail(problem);

    const onchain = await this.reader.giveaway(session.chainId, contract, giveawayId);
    // Ended some other way; the reconciler follows the indexed state.
    if (onchain.status !== "Active") return "waiting";
    if (onchain.seedCommitment !== session.seedCommitment) {
      return fail("The seed commitment on-chain is not the session's");
    }

    const computed = computeSettlement({
      giveawayId,
      ranking: session.ranking as unknown as RankedPlayer[],
      policy,
      prize: onchain.prize,
    });
    if (!computed) return fail("Nobody scored enough to win a prize");

    const message = settlementMessage(
      giveawayId,
      computed,
      session.seed as Hex,
      session.transcriptHash as Hex,
    );
    try {
      await this.db.settlement.create({
        data: {
          sessionId,
          chainId: session.chainId,
          giveawayId,
          policy,
          prize: onchain.prize.toString(),
          payoutRoot: computed.payoutRoot,
          totalPayout: computed.totalPayout.toString(),
          winnerCount: computed.winnerCount,
          seed: message.seed,
          transcriptHash: message.transcriptHash,
          digest: settlementDigest(session.chainId, contract, message),
          tree: computed.tree.dump(),
          payouts: {
            create: computed.payouts.map((payout) => ({
              account: payout.account,
              amount: payout.amount.toString(),
              rank: payout.rank,
              proof: computed.tree.proofOf(payout.account)!,
            })),
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        return "skipped";
      }
      throw error;
    }
    this.logger.log(
      `Session ${sessionId}: settlement proposed, ${computed.winnerCount} winners, ` +
        `${computed.totalPayout} of ${onchain.prize}, root ${computed.payoutRoot}`,
    );
    return "built";
  }
}
