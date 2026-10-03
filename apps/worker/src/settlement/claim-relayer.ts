import { Inject, Injectable, Logger } from "@nestjs/common";
import { fairDropsAbi } from "@fairdrops/contracts";
import { RELAY_GAS, findApprovedToken, relayFee, type Address, type Hex } from "@fairdrops/shared";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { FAIRDROPS_READER, type FairDropsReader } from "../chain/reader.js";
import { PriceFeed } from "../chain/price-feed.js";
import { CHAIN_RPC, decodeRevert, type ChainRpcFactory } from "../chain/rpc.js";
import { TxEngine } from "../chain/tx-engine.js";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";

interface Claim {
  account: Address;
  amount: bigint;
  proof: Hex[];
}

/** The relayer's cut of a prize it collects unprompted: the contract's MAX_RELAY_FEE_BPS. */
const MAX_FEE_BPS = 200n;

/**
 * Collects prizes for winners unprompted with `claimManyFor`, paying the gas, so nobody loses a
 * prize to the claim window and nobody needs gas. Prizes go to each winner (or their payout
 * wallet); the relayer keeps a fee per prize for the gas: the gas cost in the prize token, at
 * most 2% of the prize, which the contract enforces.
 */
@Injectable()
export class ClaimRelayer {
  private readonly logger = new Logger(ClaimRelayer.name);

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) private readonly db: Database,
    @Inject(FAIRDROPS_READER) private readonly reader: FairDropsReader,
    @Inject(CHAIN_RPC) private readonly rpcs: ChainRpcFactory,
    private readonly engine: TxEngine,
    private readonly prices: PriceFeed,
  ) {}

  /** Each prize's fee: the gas its share of a batch costs, in the prize token, capped at 2%. */
  private async fees(chainId: number, token: Address, batch: Claim[]): Promise<bigint[]> {
    const [quote, prices, decimals] = await Promise.all([
      this.rpcs(chainId).fees(),
      this.prices.current(),
      this.decimals(chainId, token),
    ]);
    const gasPriceWei = quote.type === "eip1559" ? quote.maxFeePerGas : quote.gasPrice;
    return batch.map((claim) => {
      const fee = relayFee({
        chainId,
        token,
        decimals,
        amount: claim.amount,
        gas: RELAY_GAS.claim / 2n,
        gasPriceWei,
        prices,
      });
      const cap = (claim.amount * MAX_FEE_BPS) / 10_000n;
      return fee > cap ? cap : fee;
    });
  }

  private async decimals(chainId: number, token: Address): Promise<number> {
    const approved = findApprovedToken(chainId, token);
    if (approved) return approved.decimals;
    const row = await this.db.token.findUnique({
      where: { chainId_address: { chainId, address: token.toLowerCase() } },
      select: { decimals: true },
    });
    return row?.decimals ?? 18;
  }

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
      claimed += await this.send(
        settlement.chainId,
        contract,
        giveaway.token as Address,
        giveawayId,
        sessionId,
        batch,
      );
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
    token: Address,
    giveawayId: Hex,
    sessionId: string,
    batch: Claim[],
  ): Promise<number> {
    const accounts = batch.map((claim) => claim.account).join(",");
    const fees = await this.fees(chainId, token, batch);
    try {
      const tx = await this.engine.send({
        chainId,
        kind: "CLAIM",
        ref: `${sessionId}:${keccak256(toHex(accounts)).slice(2, 18)}`,
        sender: "relayer",
        to: contract,
        data: encodeFunctionData({
          abi: fairDropsAbi,
          functionName: "claimManyFor",
          args: [
            batch.map((claim) => ({
              id: giveawayId,
              account: claim.account,
              amount: claim.amount,
              proof: claim.proof,
            })),
            fees,
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
        (await this.send(chainId, contract, token, giveawayId, sessionId, batch.slice(0, half))) +
        (await this.send(chainId, contract, token, giveawayId, sessionId, batch.slice(half)))
      );
    }
  }
}
