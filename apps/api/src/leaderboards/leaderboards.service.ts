import { Inject, Injectable } from "@nestjs/common";
import {
  referenceValue,
  type LeaderboardEntry,
  type LeaderboardsView,
  type TokenView,
} from "@fairdrops/shared";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { PricesService } from "../prices/prices.service.js";
import { TokensService } from "../tokens/tokens.service.js";

/** Entries per board. */
const SIZE = 10;
/** Boards change only when a giveaway is finalized; a minute of staleness is fine. */
const FRESH_MS = 60_000;

interface Row {
  account: string;
  chain_id: number;
  token: string;
  amount: string;
  count: number;
}

/**
 * Top winners and top hosts, all time, from finalized giveaways: a winner's payouts, a host's
 * total paid out. Ranked by approximate USDT so different tokens compare; only verified tokens
 * are priced, so a worthless token can't buy a top spot.
 */
@Injectable()
export class LeaderboardsService {
  private cached: { view: LeaderboardsView; at: number } | null = null;

  constructor(
    @Inject(PRISMA) private readonly db: Database,
    private readonly tokens: TokensService,
    private readonly prices: PricesService,
  ) {}

  /** Drops the cached boards, for tests. */
  clear(): void {
    this.cached = null;
  }

  async current(now = Date.now()): Promise<LeaderboardsView> {
    if (this.cached && now - this.cached.at < FRESH_MS) return this.cached.view;
    const [winners, hosts] = await Promise.all([
      this.db.$queryRaw<Row[]>`
        SELECT p.account, g.chain_id, g.token, SUM(p.amount)::text AS amount, COUNT(*)::int AS count
        FROM settlement_payouts p
        JOIN settlements s ON s.session_id = p.session_id
        JOIN giveaways g ON g.chain_id = s.chain_id AND g.giveaway_id = s.giveaway_id
        WHERE s.status = 'CONFIRMED'
        GROUP BY p.account, g.chain_id, g.token`,
      this.db.$queryRaw<Row[]>`
        SELECT g.host AS account, g.chain_id, g.token, SUM(s.total_payout)::text AS amount,
          COUNT(*)::int AS count
        FROM settlements s
        JOIN giveaways g ON g.chain_id = s.chain_id AND g.giveaway_id = s.giveaway_id
        WHERE s.status = 'CONFIRMED'
        GROUP BY g.host, g.chain_id, g.token`,
    ]);
    const tokens = await this.tokens.many(
      [...winners, ...hosts].map((row) => ({ chainId: row.chain_id, address: row.token })),
    );
    const { prices } = await this.prices.current(now);
    const view: LeaderboardsView = {
      winners: board(winners, tokens, prices),
      hosts: board(hosts, tokens, prices),
      updatedAt: new Date(now).toISOString(),
    };
    this.cached = { view, at: now };
    return view;
  }
}

function board(
  rows: Row[],
  tokens: Map<string, TokenView | null>,
  prices: Record<string, number>,
): LeaderboardEntry[] {
  const byAccount = new Map<string, Omit<LeaderboardEntry, "rank">>();
  for (const row of rows) {
    const tokenInfo = tokens.get(`${row.chain_id}:${row.token.toLowerCase()}`) ?? null;
    const value = tokenInfo
      ? (referenceValue(
          { chainId: row.chain_id, address: row.token },
          row.amount,
          tokenInfo.decimals,
          prices,
        ) ?? 0)
      : 0;
    const entry = byAccount.get(row.account) ?? {
      account: row.account as LeaderboardEntry["account"],
      count: 0,
      value: 0,
      amounts: [],
    };
    entry.count += row.count;
    entry.value += value;
    entry.amounts.push({
      chainId: row.chain_id,
      token: row.token as LeaderboardEntry["account"],
      amount: row.amount,
      tokenInfo,
    });
    byAccount.set(row.account, entry);
  }
  return [...byAccount.values()]
    .sort((a, b) => b.value - a.value || b.count - a.count || (a.account < b.account ? -1 : 1))
    .slice(0, SIZE)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
