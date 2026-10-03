import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import type { RelayRequest as RelayRow } from "@fairdrops/db";
import { findDeployment } from "@fairdrops/contracts";
import { relayCall } from "@fairdrops/settlement";
import { relayRequestSchema, type Address, type Hex } from "@fairdrops/shared";
import { Keyring } from "../chain/keyring.js";
import { decodeRevert } from "../chain/rpc.js";
import { TxEngine, TxRefused } from "../chain/tx-engine.js";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";

const BATCH = 20;

/**
 * Submits the gas-free actions the API checked and queued (relay_requests): collecting a prize
 * to a wallet, a host's withdrawal, a payout wallet, or an embedded wallet's batch (sending
 * funds, or hosting, adding to or cancelling a giveaway). The relayer
 * pays the gas and the contract pays it its fee. Each request is sent at most once (the
 * transaction engine keys it by the request id) and followed until it's mined or fails.
 */
@Injectable()
export class RelayProcessor implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(RelayProcessor.name);
  private readonly abort = new AbortController();
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) private readonly db: Database,
    private readonly engine: TxEngine,
    private readonly keyring: Keyring,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.keyring.relayer || this.env.NODE_ENV === "test") return;
    this.logger.log(`Relaying signed actions as ${this.keyring.relayer.address}`);
    this.loop = this.run();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.abort.abort();
    await this.loop;
  }

  private async run(): Promise<void> {
    const { signal } = this.abort;
    while (!signal.aborted) {
      try {
        await this.tick();
      } catch (error) {
        this.logger.warn(`Relay pass failed: ${(error as Error).message}`);
      }
      await sleep(this.env.RELAY_INTERVAL_MS, undefined, { signal }).catch(() => undefined);
    }
  }

  /** Sends what's queued, then records what's been mined or has failed. */
  async tick(): Promise<void> {
    const queued = await this.db.relayRequest.findMany({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    });
    for (const row of queued) await this.send(row);

    const sent = await this.db.relayRequest.findMany({
      where: { status: "SENT" },
      include: { tx: true },
      take: BATCH * 5,
    });
    for (const row of sent) {
      const tx = row.tx;
      if (!tx) continue;
      if (tx.status === "MINED") {
        await this.finish(row.id, "MINED", { txHash: tx.minedHash ?? row.txHash });
        this.logger.log(`Relay ${row.action} ${row.id}: mined in ${tx.minedHash}`);
      } else if (tx.status === "REVERTED" || tx.status === "FAILED" || tx.status === "DROPPED") {
        await this.finish(row.id, "FAILED", {
          txHash: tx.minedHash ?? row.txHash,
          error: tx.error ?? `The transaction ${tx.status.toLowerCase()}`,
        });
      }
    }
  }

  private async send(row: RelayRow): Promise<void> {
    const parsed = relayRequestSchema.safeParse(row.payload);
    const deployment = findDeployment(row.chainId);
    if (!parsed.success || !deployment) {
      await this.finish(row.id, "FAILED", { error: "The request can't be sent on this chain" });
      return;
    }
    const proof = (row.payload as { proof?: Hex[] }).proof;
    const call = relayCall(parsed.data, {
      contract: deployment.address.toLowerCase() as Address,
      proof,
    });
    try {
      const tx = await this.engine.send({
        chainId: row.chainId,
        kind: "RELAY",
        ref: row.id,
        sender: "relayer",
        to: call.to,
        data: call.data,
        value: call.value,
        ...(call.authorizationList ? { authorizationList: call.authorizationList } : {}),
      });
      // Conditional: another worker may have moved it on already.
      await this.db.relayRequest.updateMany({
        where: { id: row.id, status: "QUEUED" },
        data: { status: "SENT", txId: tx.id, txHash: tx.hashes.at(-1) ?? null },
      });
    } catch (error) {
      const revert = decodeRevert(error);
      if (revert || error instanceof TxRefused) {
        const reason = revert ? revert.errorName : (error as Error).message;
        this.logger.warn(`Relay ${row.action} ${row.id} refused: ${reason}`);
        await this.finish(row.id, "FAILED", { error: plainReason(reason) });
        return;
      }
      throw error;
    }
  }

  private async finish(
    id: string,
    status: "MINED" | "FAILED",
    data: { txHash?: string | null; error?: string },
  ): Promise<void> {
    await this.db.relayRequest.updateMany({
      where: { id, status: { in: ["QUEUED", "SENT"] } },
      data: { status, ...data },
    });
  }
}

/** Contract errors in words people can act on. */
function plainReason(reason: string): string {
  switch (reason) {
    case "AlreadyClaimed":
      return "This prize was already collected";
    case "SignatureExpired":
      return "The signature expired before it could be sent. Try again.";
    case "InvalidAccountNonce":
      return "Another action went through first. Try again.";
    case "NothingToWithdraw":
      return "There's nothing left to withdraw";
    case "ClaimWindowClosed":
      return "The time to collect this prize has passed";
    default:
      return `It couldn't go through (${reason})`;
  }
}
