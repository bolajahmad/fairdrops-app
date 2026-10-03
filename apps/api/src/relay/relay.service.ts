import { Inject, Injectable } from "@nestjs/common";
import type { RelayRequest as RelayRow } from "@fairdrops/db";
import { FAIRDROPS_ACCOUNT_ADDRESS, findDeployment } from "@fairdrops/contracts";
import { RelayRejected, checkExecuteCalls, relayCall, relaySigner } from "@fairdrops/settlement";
import {
  NATIVE_TOKEN_ADDRESS,
  RELAY_GAS,
  executeGas,
  relayFee,
  type Address,
  type Hex,
  type RelayQuote,
  type RelayQuoteQuery,
  type RelayRequest,
  type RelayView,
} from "@fairdrops/shared";
import type { AuthContext } from "../auth/auth.types.js";
import { AppException } from "../common/app.exception.js";
import { API_ENV, type ApiEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { PricesService } from "../prices/prices.service.js";
import { TokensService } from "../tokens/tokens.service.js";
import { RELAY_CHAIN, type RelayChain } from "./relay-chain.js";

/** How long a quote's signature stays valid. */
const QUOTE_TTL_SECONDS = 15 * 60;
/** A signed fee may sit this far below a fresh quote, for gas and price moves in between. */
const FEE_TOLERANCE_BPS = 8_000n;
/** Signatures must still be good for this long when they arrive, so the relayer has time. */
const MIN_REMAINING_SECONDS = 30;

/**
 * Gas-free actions. Quotes the relayer's fee; checks a signed request (who signed it, the nonce,
 * the fee, what an embedded wallet's batch does: send, host, or manage a giveaway it hosts; and
 * that it would succeed on-chain); and queues it for the worker's relayer, which submits it and
 * pays the gas.
 */
@Injectable()
export class RelayService {
  constructor(
    @Inject(PRISMA) private readonly db: Database,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(RELAY_CHAIN) private readonly chain: RelayChain,
    private readonly tokens: TokensService,
    private readonly prices: PricesService,
  ) {}

  async quote(query: RelayQuoteQuery): Promise<RelayQuote> {
    const relayer = this.relayer();
    const contract = this.contract(query.chainId);
    const account = query.account;
    const state =
      query.action === "execute" ? await this.chain.accountState(query.chainId, account) : null;
    const [fee, nonce] = await Promise.all([
      this.fee(query.chainId, query.token, BigInt(query.amount), this.gasFor(query, state)),
      state
        ? Promise.resolve(state.nonce)
        : this.chain.contractNonce(query.chainId, contract, account),
    ]);
    return {
      chainId: query.chainId,
      action: query.action,
      token: query.token,
      fee: fee.toString(),
      relayer,
      contract,
      nonce: nonce.toString(),
      deadline: Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS,
      delegate: state ? FAIRDROPS_ACCOUNT_ADDRESS : null,
      delegated: state ? state.delegated : null,
      authorizationNonce: state && !state.delegated ? state.transactionCount : null,
    };
  }

  async submit(auth: AuthContext, request: RelayRequest): Promise<RelayView> {
    const relayer = this.relayer();
    const contract = this.contract(request.chainId);
    const now = Math.floor(Date.now() / 1000);
    if (request.deadline < now + MIN_REMAINING_SECONDS) {
      throw AppException.conflict("This signature has expired. Sign again.");
    }

    const signer = signerField(request);
    if (signer !== auth.wallet) {
      throw AppException.forbidden("You can only send actions for your own account");
    }
    if ((await relaySigner(request, contract)) !== signer) {
      throw AppException.forbidden("The signature doesn't match the account");
    }

    let token: Address = NATIVE_TOKEN_ADDRESS;
    let amount = 0n;
    let fee = 0n;
    let proof: Hex[] | undefined;
    let gas = RELAY_GAS[request.action];

    switch (request.action) {
      case "claim": {
        await this.checkNonce(request.chainId, contract, signer, request.nonce);
        const payout = await this.db.settlementPayout.findFirst({
          where: {
            account: request.account,
            settlement: {
              chainId: request.chainId,
              giveawayId: request.giveawayId,
              status: "CONFIRMED",
            },
          },
          include: { settlement: { include: { session: { include: { giveaway: true } } } } },
        });
        if (!payout) throw AppException.notFound("No prize to collect for this account");
        if (payout.claimedAt) throw AppException.conflict("This prize was already collected");
        if (payout.amount.toFixed() !== request.amount) {
          throw AppException.conflict("The amount doesn't match the prize");
        }
        token = payout.settlement.session.giveaway.token as Address;
        amount = BigInt(request.amount);
        fee = BigInt(request.fee);
        proof = payout.proof as Hex[];
        break;
      }
      case "withdraw": {
        await this.checkNonce(request.chainId, contract, signer, request.nonce);
        const giveaway = await this.db.giveaway.findUnique({
          where: {
            chainId_giveawayId: { chainId: request.chainId, giveawayId: request.giveawayId },
          },
        });
        if (!giveaway) throw AppException.notFound("No such giveaway");
        if (giveaway.host !== request.host)
          throw AppException.forbidden("Only the host can withdraw");
        token = giveaway.token as Address;
        amount = await this.chain.hostWithdrawable(request.chainId, contract, request.giveawayId);
        fee = BigInt(request.fee);
        if (amount === 0n) throw AppException.conflict("There's nothing to withdraw");
        break;
      }
      case "payoutWallet":
        await this.checkNonce(request.chainId, contract, signer, request.nonce);
        break;
      case "execute": {
        const state = await this.chain.accountState(request.chainId, request.account);
        if (BigInt(request.nonce) !== state.nonce) {
          throw AppException.conflict("This signature is out of date. Sign again.");
        }
        if (!state.delegated) {
          const authorization = request.authorization;
          if (
            !authorization ||
            authorization.address.toLowerCase() !== FAIRDROPS_ACCOUNT_ADDRESS ||
            authorization.chainId !== request.chainId ||
            authorization.nonce !== state.transactionCount
          ) {
            throw AppException.conflict("This wallet needs a fresh authorization. Sign again.");
          }
        }
        gas = executeGas(request.purpose, state.delegated);
        let summary;
        try {
          summary = checkExecuteCalls(request.calls, request.purpose, { contract, relayer });
        } catch (error) {
          if (error instanceof RelayRejected) throw AppException.forbidden(error.message);
          throw error;
        }
        ({ token, amount, fee } = summary);
        if (summary.giveawayId) {
          // Managing a giveaway: only its host, in its prize token. A cancel's fee comes out of
          // the refund, so it's weighed against the prize.
          const giveaway = await this.db.giveaway.findUnique({
            where: {
              chainId_giveawayId: { chainId: request.chainId, giveawayId: summary.giveawayId },
            },
          });
          if (!giveaway) throw AppException.notFound("No such giveaway");
          if (giveaway.host !== request.account) {
            throw AppException.forbidden("Only the host can change this giveaway");
          }
          if (giveaway.token !== token) {
            throw AppException.forbidden("Pay the fee in the prize token");
          }
          if (amount === 0n) amount = BigInt(giveaway.prize.toFixed());
        }
        break;
      }
    }

    if (request.action !== "payoutWallet") {
      const minimum = (await this.fee(request.chainId, token, amount, gas)) * FEE_TOLERANCE_BPS;
      if (fee * 10_000n < minimum) {
        throw AppException.conflict("The fee is out of date. Get a new quote and sign again.");
      }
      if (fee >= amount) throw AppException.conflict("The fee would take everything");
    }

    try {
      await this.chain.simulate(request.chainId, relayer, relayCall(request, { contract, proof }));
    } catch (error) {
      throw AppException.conflict(
        `This would fail on-chain: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const row = await this.db.relayRequest.create({
      data: {
        chainId: request.chainId,
        action: request.action,
        account: signer,
        userId: auth.userId,
        payload: { ...request, ...(proof ? { proof } : {}) },
        fee: fee.toString(),
        feeToken: token,
      },
    });
    return toRelayView(row);
  }

  async get(id: string): Promise<RelayView> {
    const row = await this.db.relayRequest.findUnique({ where: { id } });
    if (!row) throw AppException.notFound("No such request");
    return toRelayView(row);
  }

  private async fee(chainId: number, token: Address, amount: bigint, gas: bigint): Promise<bigint> {
    const [info, gasPriceWei, { prices }] = await Promise.all([
      this.tokens.get(chainId, token),
      this.chain.gasPrice(chainId),
      this.prices.current(),
    ]);
    return relayFee({ chainId, token, decimals: info.decimals, amount, gas, gasPriceWei, prices });
  }

  private gasFor(query: RelayQuoteQuery, state: { delegated: boolean } | null): bigint {
    if (query.action !== "execute") return RELAY_GAS[query.action];
    return executeGas(query.purpose, state?.delegated ?? true);
  }

  private async checkNonce(
    chainId: number,
    contract: Address,
    account: Address,
    nonce: string,
  ): Promise<void> {
    if (BigInt(nonce) !== (await this.chain.contractNonce(chainId, contract, account))) {
      throw AppException.conflict("This signature is out of date. Sign again.");
    }
  }

  private relayer(): Address {
    const relayer = this.env.RELAYER_ADDRESS;
    if (!relayer) throw AppException.forbidden("Gas-free actions aren't set up on this server");
    return relayer;
  }

  private contract(chainId: number): Address {
    const deployment = findDeployment(chainId);
    if (!deployment) throw AppException.notFound(`FairDrops isn't deployed on chain ${chainId}`);
    return deployment.address.toLowerCase() as Address;
  }
}

/** The account that has to sign a request. */
function signerField(request: RelayRequest): Address {
  switch (request.action) {
    case "withdraw":
      return request.host;
    case "claim":
    case "payoutWallet":
    case "execute":
      return request.account;
  }
}

export function toRelayView(row: RelayRow): RelayView {
  return {
    id: row.id,
    chainId: row.chainId,
    action: row.action as RelayView["action"],
    account: row.account as Address,
    status: row.status,
    fee: row.fee.toFixed(),
    feeToken: row.feeToken as Address,
    txHash: (row.txHash as Hex | null) ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
