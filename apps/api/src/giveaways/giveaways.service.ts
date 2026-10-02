import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@fairdrops/db";
import type {
  Address,
  ClaimView,
  GiveawayEventView,
  GiveawayListQuery,
  GiveawayView,
  Hex,
  Page,
  PaginationQuery,
  PayoutTreeDump,
  SettlementView,
  TokenView,
} from "@fairdrops/shared";
import { AppException } from "../common/app.exception.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { TokensService } from "../tokens/tokens.service.js";
import { toClaimView, toEventView, toGiveawayView, toSettlementView } from "./giveaways.mapper.js";

interface ListCursor {
  createdAt: string;
  chainId: number;
  giveawayId: string;
}

function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): ListCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as ListCursor;
    if (
      typeof parsed.createdAt === "string" &&
      typeof parsed.chainId === "number" &&
      typeof parsed.giveawayId === "string"
    ) {
      return parsed;
    }
  } catch {
    // Falls through to the error below.
  }
  throw new AppException("VALIDATION_FAILED", "Invalid cursor");
}

const settlementInclude = {
  payouts: true,
  signatures: true,
  finalizeTx: true,
  session: { select: { giveaway: { select: { contractAddress: true } } } },
} satisfies Prisma.SettlementInclude;

/**
 * Giveaways as the indexer copied them from the chain, their results and their claims. Read
 * only: the worker writes all of this.
 */
@Injectable()
export class GiveawaysService {
  constructor(
    @Inject(PRISMA) private readonly db: Database,
    private readonly tokens: TokensService,
  ) {}

  private tokenOf(tokens: Map<string, TokenView | null>, chainId: number, address: string) {
    return tokens.get(`${chainId}:${address.toLowerCase()}`) ?? null;
  }

  /** Newest first, across chains. */
  async list(query: GiveawayListQuery): Promise<Page<GiveawayView>> {
    const where: Prisma.GiveawayWhereInput = {
      ...(query.chainId ? { chainId: query.chainId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.host ? { host: query.host } : {}),
    };
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      const at = new Date(c.createdAt);
      where.OR = [
        { createdAt: { lt: at } },
        { createdAt: at, chainId: { gt: c.chainId } },
        { createdAt: at, chainId: c.chainId, giveawayId: { gt: c.giveawayId } },
      ];
    }
    const rows = await this.db.giveaway.findMany({
      where,
      include: { session: { select: { id: true, status: true, failureReason: true } } },
      orderBy: [{ createdAt: "desc" }, { chainId: "asc" }, { giveawayId: "asc" }],
      take: query.limit + 1,
    });
    const now = new Date();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const tokens = await this.tokens.many(
      page.map((row) => ({ chainId: row.chainId, address: row.token })),
    );
    return {
      items: page.map((row) =>
        toGiveawayView(row, row.session, this.tokenOf(tokens, row.chainId, row.token), now),
      ),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({
              createdAt: last.createdAt.toISOString(),
              chainId: last.chainId,
              giveawayId: last.giveawayId,
            })
          : null,
    };
  }

  async get(chainId: number, giveawayId: Hex): Promise<GiveawayView> {
    const giveaway = await this.db.giveaway.findUnique({
      where: { chainId_giveawayId: { chainId, giveawayId } },
      include: { session: { select: { id: true, status: true, failureReason: true } } },
    });
    if (!giveaway) throw AppException.notFound("No such giveaway (it may not be indexed yet)");
    const tokens = await this.tokens.many([{ chainId, address: giveaway.token }]);
    return toGiveawayView(
      giveaway,
      giveaway.session,
      this.tokenOf(tokens, chainId, giveaway.token),
    );
  }

  /** The giveaway's on-chain activity, oldest first. */
  async events(
    chainId: number,
    giveawayId: Hex,
    query: PaginationQuery,
  ): Promise<Page<GiveawayEventView>> {
    await this.get(chainId, giveawayId);
    let after: { block: bigint; log: number } | null = null;
    if (query.cursor) {
      const match = /^(\d+):(\d+)$/.exec(query.cursor);
      if (!match) throw new AppException("VALIDATION_FAILED", "Invalid cursor");
      after = { block: BigInt(match[1]!), log: Number(match[2]) };
    }
    const rows = await this.db.giveawayEvent.findMany({
      where: {
        chainId,
        giveawayId,
        ...(after
          ? {
              OR: [
                { blockNumber: { gt: after.block } },
                { blockNumber: after.block, logIndex: { gt: after.log } },
              ],
            }
          : {}),
      },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toEventView),
      nextCursor: rows.length > query.limit && last ? `${last.blockNumber}:${last.logIndex}` : null,
    };
  }

  async settlement(sessionId: string): Promise<SettlementView> {
    const settlement = await this.db.settlement.findUnique({
      where: { sessionId },
      include: settlementInclude,
    });
    if (!settlement) {
      const session = await this.db.gameSession.findUnique({ where: { id: sessionId } });
      if (!session) throw AppException.notFound("No such session");
      throw AppException.conflict(`This session has no settlement yet (${session.status})`);
    }
    return toSettlementView(settlement);
  }

  async payoutTree(sessionId: string): Promise<PayoutTreeDump> {
    const settlement = await this.db.settlement.findUnique({
      where: { sessionId },
      select: { tree: true },
    });
    if (!settlement) throw AppException.notFound("This session has no settlement yet");
    return settlement.tree as unknown as PayoutTreeDump;
  }

  /** What an account won in a giveaway, with the proof to claim it. */
  async claim(chainId: number, giveawayId: Hex, account: Address): Promise<ClaimView> {
    const settlement = await this.db.settlement.findUnique({
      where: { chainId_giveawayId: { chainId, giveawayId } },
      include: {
        payouts: { where: { account } },
        session: { include: { giveaway: true } },
      },
    });
    if (!settlement || settlement.status === "ABANDONED") {
      throw AppException.notFound("This giveaway has no result to claim from");
    }
    const payout = settlement.payouts[0];
    if (!payout) throw AppException.notFound(`${account} did not win in this giveaway`);
    const { giveaway } = settlement.session;
    const wallet = await this.db.payoutWallet.findUnique({
      where: {
        chainId_contractAddress_account: {
          chainId,
          contractAddress: giveaway.contractAddress,
          account,
        },
      },
    });
    const tokens = await this.tokens.many([{ chainId, address: giveaway.token }]);
    return toClaimView(
      payout,
      settlement,
      giveaway,
      wallet?.wallet ?? null,
      this.tokenOf(tokens, chainId, giveaway.token),
    );
  }

  /** Every prize won by any wallet linked to the user, newest first. */
  async claimsOf(userId: string): Promise<ClaimView[]> {
    const wallets = await this.db.wallet.findMany({ where: { userId }, select: { address: true } });
    const payouts = await this.db.settlementPayout.findMany({
      where: {
        account: { in: wallets.map((w) => w.address) },
        settlement: { status: { not: "ABANDONED" } },
      },
      include: { settlement: { include: { session: { include: { giveaway: true } } } } },
      orderBy: { settlement: { createdAt: "desc" } },
      take: 100,
    });
    const redirects = await this.db.payoutWallet.findMany({
      where: { account: { in: payouts.map((p) => p.account) } },
    });
    const now = new Date();
    const tokens = await this.tokens.many(
      payouts.map((payout) => ({
        chainId: payout.settlement.session.giveaway.chainId,
        address: payout.settlement.session.giveaway.token,
      })),
    );
    return payouts.map((payout) => {
      const { giveaway } = payout.settlement.session;
      const redirect = redirects.find(
        (r) =>
          r.chainId === giveaway.chainId &&
          r.contractAddress === giveaway.contractAddress &&
          r.account === payout.account,
      );
      return toClaimView(
        payout,
        payout.settlement,
        giveaway,
        redirect?.wallet ?? null,
        this.tokenOf(tokens, giveaway.chainId, giveaway.token),
        now,
      );
    });
  }
}
