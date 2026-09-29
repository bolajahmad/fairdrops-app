import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import { deployments } from "@fairdrops/contracts";
import { chainsInEnvironment } from "@fairdrops/shared";
import { Redis } from "ioredis";
import { formatEther } from "viem";
import { Keyring } from "../chain/keyring.js";
import { CHAIN_RPC, type ChainRpcFactory } from "../chain/rpc.js";
import { TxEngine } from "../chain/tx-engine.js";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { REDIS } from "../infra/redis.module.js";
import { Lease } from "../sessions/lease.js";
import { SessionLifecycle } from "../sessions/session-lifecycle.js";
import { WORKER_ID } from "../sessions/worker-id.js";
import { SettlementQueues } from "./settlement-queues.js";
import { SettlementSubmitter } from "./settlement-submitter.js";

const LEASE_KEY = "fd:lease:settlement";
const BATCH = 200;
const BALANCE_CHECK_MS = 5 * 60_000;

/**
 * Keeps settlements moving and in step with the chain. One worker reconciles at a time (a Redis
 * lease); every step is conditional on the state it starts from, so a second reconciler during a
 * handover does no harm. Each pass:
 *
 * 1. follows transactions in flight (receipts, rebroadcasts, fee bumps);
 * 2. schedules the next step of every settlement: build, submit, relay claims;
 * 3. confirms settlements from the indexed GiveawayFinalized event, and abandons those whose
 *    giveaway was cancelled, expired or passed its finalize deadline;
 * 4. copies indexed claims onto payouts;
 * 5. schedules on-chain cancellation of giveaways whose game ended without a result.
 */
@Injectable()
export class SettlementReconciler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(SettlementReconciler.name);
  private readonly abort = new AbortController();
  private readonly lease: Lease;
  private readonly warned = new Set<string>();
  private loop: Promise<void> | null = null;
  private lastBalanceCheck = 0;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
    @Inject(CHAIN_RPC) private readonly rpcs: ChainRpcFactory,
    private readonly keyring: Keyring,
    private readonly engine: TxEngine,
    private readonly queues: SettlementQueues,
    private readonly submitter: SettlementSubmitter,
    private readonly lifecycle: SessionLifecycle,
  ) {
    this.lease = new Lease(
      redis,
      LEASE_KEY,
      WORKER_ID,
      Math.max(env.SETTLEMENT_INTERVAL_MS * 5, 10_000),
    );
  }

  onApplicationBootstrap(): void {
    if (this.env.SETTLEMENT_ENABLED) this.loop = this.run();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.abort.abort();
    await this.loop;
    await this.lease.release().catch(() => undefined);
  }

  private async run(): Promise<void> {
    const { signal } = this.abort;
    while (!signal.aborted) {
      try {
        if ((await this.lease.renew()) || (await this.lease.acquire())) await this.tick();
      } catch (error) {
        this.logger.warn(`Settlement pass failed: ${(error as Error).message}`);
      }
      await sleep(this.env.SETTLEMENT_INTERVAL_MS, undefined, { signal }).catch(() => undefined);
    }
  }

  async tick(now = new Date()): Promise<void> {
    await this.engine.reconcile(now);
    await this.followTransactions();
    await this.confirm(now);
    await this.syncClaims();
    await this.scheduleSteps(now);
    await this.checkBalances(now);
  }

  /** A finalize transaction that reverted or was dropped makes way for another. */
  async followTransactions(): Promise<void> {
    const failed = await this.db.settlement.findMany({
      where: {
        status: "SUBMITTED",
        finalizeTx: { status: { in: ["REVERTED", "FAILED", "DROPPED"] } },
      },
      select: { sessionId: true, finalizeTxId: true },
      take: BATCH,
    });
    for (const settlement of failed) {
      await this.submitter.retry(settlement.sessionId, settlement.finalizeTxId!);
    }
  }

  /** Brings settled sessions in line with the chain, as the indexer recorded it. */
  async confirm(now: Date): Promise<void> {
    const sessions = await this.db.gameSession.findMany({
      where: { status: { in: ["SETTLING", "FINALIZING"] } },
      include: { giveaway: true, settlement: { include: { finalizeTx: true } } },
      take: BATCH,
    });

    for (const session of sessions) {
      const { giveaway, settlement } = session;
      if (giveaway.status === "FINALIZED") {
        const ours =
          settlement &&
          giveaway.payoutRoot === settlement.payoutRoot &&
          giveaway.transcriptHash === settlement.transcriptHash;
        if (ours) {
          await this.db.settlement.updateMany({
            where: { sessionId: session.id, status: { notIn: ["CONFIRMED", "ABANDONED"] } },
            data: { status: "CONFIRMED", confirmedAt: now, failureReason: null },
          });
          await this.lifecycle.finalized(session.id);
          continue;
        }
        const reason = "The giveaway was finalized on-chain with a different result";
        this.logger.error(
          `Session ${session.id}: ${reason} (root ${giveaway.payoutRoot}, ours ` +
            `${settlement?.payoutRoot ?? "none"})`,
        );
        await this.submitter.abandon(session.id, reason);
        continue;
      }

      if (giveaway.status === "CANCELLED" || giveaway.status === "EXPIRED") {
        const reason = `The giveaway was ${giveaway.status.toLowerCase()} on-chain`;
        await this.db.settlement.updateMany({
          where: { sessionId: session.id, status: { notIn: ["CONFIRMED", "ABANDONED"] } },
          data: { status: "ABANDONED", failureReason: reason },
        });
        await this.lifecycle.cancel(session.id, ["SETTLING", "FINALIZING"], reason);
        continue;
      }

      // Still ACTIVE on-chain. A finalize already mined is only waiting for the indexer.
      if (settlement?.finalizeTx?.status === "MINED") continue;
      if (now > giveaway.finalizeDeadline) {
        await this.submitter.abandon(
          session.id,
          "The result was not finalized before the deadline; the host can withdraw a full refund",
        );
        continue;
      }
      const margin = this.env.SESSION_SETTLEMENT_MARGIN_SECONDS * 1000;
      if (
        giveaway.finalizeDeadline.getTime() - now.getTime() < margin / 2 &&
        !this.warned.has(session.id)
      ) {
        this.warned.add(session.id);
        this.logger.warn(
          `Session ${session.id}: not finalized yet, ${settlement?.status ?? "no settlement"}, ` +
            `deadline ${giveaway.finalizeDeadline.toISOString()}`,
        );
      }
    }
  }

  /** Marks payouts claimed from the indexed Claimed events. */
  async syncClaims(): Promise<number> {
    return this.db.$executeRaw`
      UPDATE settlement_payouts p
      SET claimed_at = e.timestamp, claim_tx = e.transaction_hash
      FROM settlements s, giveaway_events e
      WHERE p.session_id = s.session_id
        AND p.claimed_at IS NULL
        AND e.chain_id = s.chain_id
        AND e.giveaway_id = s.giveaway_id
        AND e.kind = 'CLAIMED'
        AND e.account = p.account`;
  }

  async scheduleSteps(now: Date): Promise<void> {
    const unbuilt = await this.db.gameSession.findMany({
      where: { status: "SETTLING", settlement: null, giveaway: { status: "ACTIVE" } },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of unbuilt) await this.queues.schedule("build", id);

    const signed = await this.db.settlement.findMany({
      where: { status: "SIGNED" },
      select: { sessionId: true },
      take: BATCH,
    });
    for (const { sessionId } of signed) await this.queues.schedule("submit", sessionId);

    if (this.env.CLAIM_RELAY_ENABLED) {
      const claimable = await this.db.settlement.findMany({
        where: {
          status: "CONFIRMED",
          payouts: { some: { claimedAt: null } },
          session: { giveaway: { claimDeadline: { gt: now } } },
        },
        select: { sessionId: true },
        take: BATCH,
      });
      for (const { sessionId } of claimable) await this.queues.schedule("relay", sessionId);
    }

    if (this.env.UNWIND_ENABLED) {
      const unwound = await this.db.gameSession.findMany({
        where: { status: { in: ["CANCELLED", "FAILED"] }, giveaway: { status: "ACTIVE" } },
        select: { id: true },
        take: BATCH,
      });
      for (const { id } of unwound) await this.queues.schedule("cancel", id);
    }
  }

  /** Warns when a key that pays gas runs low on a chain it sends on. */
  private async checkBalances(now: Date): Promise<void> {
    if (now.getTime() - this.lastBalanceCheck < BALANCE_CHECK_MS) return;
    this.lastBalanceCheck = now.getTime();
    const chainIds = new Set(deployments.map((d) => d.chainId));
    for (const chain of chainsInEnvironment(this.env.DEPLOYMENT_ENVIRONMENT)) {
      if (!chainIds.has(chain.chainId)) continue;
      for (const payer of this.keyring.payers()) {
        try {
          const balance = await this.rpcs(chain.chainId).balance(payer);
          if (balance < this.env.LOW_BALANCE_WEI) {
            this.logger.warn(
              `${payer} has ${formatEther(balance)} ${chain.nativeCurrency.symbol} on ${chain.name}; ` +
                "top it up or transactions there will fail",
            );
          }
        } catch (error) {
          this.logger.warn(`Balance check on ${chain.name} failed: ${(error as Error).message}`);
        }
      }
    }
  }
}
