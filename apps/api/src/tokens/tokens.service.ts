import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Token } from "@fairdrops/db";
import {
  addressSchema,
  approvedTokens,
  findApprovedToken,
  findChain,
  hostableChains,
  toTokenView,
  type Address,
  type TokenSearchQuery,
  type TokenView,
} from "@fairdrops/shared";
import { AppException } from "../common/app.exception.js";
import { API_ENV, type ApiEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { TOKEN_READER, type TokenReader } from "./token-reader.js";

const key = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

/** A stored row as a view. Rows hold only tokens read from the chain or imported from a list. */
function fromRow(row: Token): TokenView {
  return toTokenView(
    {
      chainId: row.chainId,
      address: row.address as Address,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
    },
    row.listed,
  );
}

/**
 * Every token's chain, symbol, name and decimals, from FairDrops' list, the `tokens` table, or
 * (once) the token contract itself. Giveaway and claim views get theirs from here, so an amount
 * is never shown without its token.
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  /** Lookups in flight, so concurrent requests for a new token read the chain once. */
  private readonly pending = new Map<string, Promise<TokenView | null>>();

  constructor(
    @Inject(PRISMA) private readonly db: Database,
    @Inject(TOKEN_READER) private readonly reader: TokenReader,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** One token, reading the contract if FairDrops has never seen it. */
  async get(chainId: number, address: Address): Promise<TokenView> {
    if (!findChain(chainId)) throw AppException.notFound(`Chain ${chainId} is not supported`);
    const token = await this.resolve(chainId, address);
    if (!token) {
      throw AppException.notFound(
        `${address} isn't an ERC-20 token on ${findChain(chainId)?.name ?? `chain ${chainId}`}`,
      );
    }
    return token;
  }

  /**
   * Many tokens at once, for lists: one table query, then the chain only for tokens never seen
   * before. A token that cannot be read maps to null rather than failing the whole list.
   */
  async many(
    pairs: { chainId: number; address: string }[],
  ): Promise<Map<string, TokenView | null>> {
    const out = new Map<string, TokenView | null>();
    const unknown: { chainId: number; address: string }[] = [];
    for (const pair of pairs) {
      const id = key(pair.chainId, pair.address);
      if (out.has(id)) continue;
      const approved = findApprovedToken(pair.chainId, pair.address);
      if (approved) out.set(id, toTokenView(approved));
      else unknown.push(pair);
    }
    if (unknown.length) {
      const rows = await this.db.token.findMany({
        where: {
          OR: unknown.map((pair) => ({
            chainId: pair.chainId,
            address: pair.address.toLowerCase(),
          })),
        },
      });
      for (const row of rows) out.set(key(row.chainId, row.address), fromRow(row));
      await Promise.all(
        unknown
          .filter((pair) => !out.has(key(pair.chainId, pair.address)))
          .map(async (pair) => {
            const token = await this.resolve(pair.chainId, pair.address as Address).catch(
              () => null,
            );
            out.set(key(pair.chainId, pair.address), token);
          }),
      );
    }
    return out;
  }

  /**
   * Search by symbol or name among known tokens on hostable chains, best matches first. An
   * address is looked up on the chain (or every hostable chain), so hosts can paste one.
   */
  async search(query: TokenSearchQuery): Promise<TokenView[]> {
    const chainIds = hostableChains(this.env.DEPLOYMENT_ENVIRONMENT)
      .map((chain) => chain.chainId)
      .filter((chainId) => query.chainId === undefined || chainId === query.chainId);
    if (!chainIds.length) return [];
    const q = query.q?.trim() ?? "";

    const asAddress = addressSchema.safeParse(q);
    if (asAddress.success) {
      const found = await Promise.all(
        chainIds.map((chainId) => this.resolve(chainId, asAddress.data).catch(() => null)),
      );
      return found.filter((token): token is TokenView => token !== null);
    }

    const needle = q.toLowerCase();
    const known = approvedTokens
      .filter((token) => chainIds.includes(token.chainId))
      .map((token) => toTokenView(token));
    const rows = await this.db.token.findMany({
      where: {
        chainId: { in: chainIds },
        ...(needle
          ? {
              OR: [
                { symbol: { contains: needle, mode: "insensitive" } },
                { name: { contains: needle, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      take: 200,
    });
    // A token on FairDrops' list may also have been stored before it was listed: list wins.
    const byKey = new Map<string, TokenView>();
    for (const token of [...known, ...rows.map((row) => fromRow(row))]) {
      const id = key(token.chainId, token.address);
      if (!byKey.has(id)) byKey.set(id, token);
    }
    const all = [...byKey.values()];
    const rank = (token: TokenView) => {
      const symbol = token.symbol.toLowerCase();
      const name = token.name.toLowerCase();
      const match = !needle
        ? 0
        : symbol === needle
          ? 0
          : symbol.startsWith(needle)
            ? 1
            : name.startsWith(needle)
              ? 2
              : symbol.includes(needle) || name.includes(needle)
                ? 3
                : -1;
      const trust = { verified: 0, listed: 1, unverified: 2 }[token.trust];
      return match < 0 ? -1 : match * 10 + trust;
    };
    return all
      .map((token) => ({ token, score: rank(token) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score || a.token.symbol.localeCompare(b.token.symbol))
      .slice(0, query.limit)
      .map((entry) => entry.token);
  }

  private resolve(chainId: number, address: Address): Promise<TokenView | null> {
    const id = key(chainId, address);
    const running = this.pending.get(id);
    if (running) return running;
    const work = this.lookup(chainId, address.toLowerCase() as Address).finally(() =>
      this.pending.delete(id),
    );
    this.pending.set(id, work);
    return work;
  }

  private async lookup(chainId: number, address: Address): Promise<TokenView | null> {
    const approved = findApprovedToken(chainId, address);
    if (approved) return toTokenView(approved);
    const row = await this.db.token.findUnique({
      where: { chainId_address: { chainId, address } },
    });
    if (row) return fromRow(row);
    if (!findChain(chainId)) return null;

    // An RPC failure reads as "not a token" here; the next lookup tries again.
    const metadata = await this.reader.read(chainId, address).catch((error: unknown) => {
      this.logger.warn(`Could not read token ${address} on ${chainId}: ${String(error)}`);
      return null;
    });
    if (!metadata || metadata.decimals < 0 || metadata.decimals > 36) return null;
    const stored = await this.db.token.upsert({
      where: { chainId_address: { chainId, address } },
      create: { chainId, address, ...metadata, source: "chain" },
      update: {},
    });
    this.logger.log(
      `Learned ${stored.symbol} (${stored.decimals} decimals) at ${address} on ${chainId}`,
    );
    return fromRow(stored);
  }
}
