import { Inject, Injectable, Logger } from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import {
  UNIQUE_VIOLATION,
  Prisma,
  type ChainTransaction,
  type ChainTxKind,
  type ChainTxStatus,
} from "@fairdrops/db";
import { findChain, type Address, type Hex } from "@fairdrops/shared";
import { Redis } from "ioredis";
import { BaseError, HttpRequestError, TimeoutError, keccak256 } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { REDIS } from "../infra/redis.module.js";
import { Lease } from "../sessions/lease.js";
import { WORKER_ID } from "../sessions/worker-id.js";
import { Keyring, type SenderRole } from "./keyring.js";
import { CHAIN_RPC, type ChainRpc, type ChainRpcFactory, type FeeQuote } from "./rpc.js";

/** Headroom over the estimate. Kept small: some chains (Monad) bill the gas limit, not gas used. */
const GAS_BUFFER_BPS = 1_500n;
const BUMP_NUMERATOR = 1_125n;
const BUMP_DENOMINATOR = 1_000n;
const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_MS = 30_000;
const POLL_MS = 2_000;
/** A SIGNED transaction older than this was probably never broadcast (a crash); resend it. */
const REBROADCAST_AFTER_MS = 15_000;

const IN_FLIGHT: ChainTxStatus[] = ["SIGNED", "SENT"];
const SETTLED: ChainTxStatus[] = ["MINED", "REVERTED", "FAILED", "DROPPED"];

/** What a transaction is for. The engine sends at most one at a time per kind and ref. */
export interface TxIntent {
  chainId: number;
  kind: ChainTxKind;
  /** Identifies the intent with `kind`, e.g. a session id. */
  ref: string;
  sender: SenderRole;
  to: Address;
  data: Hex;
  value?: bigint;
}

/** The node refused the transaction outright, so its nonce was not used. */
export class TxRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxRefused";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return error.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError) !== null;
}

function describe(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}

function bump(value: bigint): bigint {
  return (value * BUMP_NUMERATOR) / BUMP_DENOMINATOR + 1n;
}

/**
 * Sends every transaction the worker makes, and keeps a ledger of them in Postgres.
 *
 * - **Nonces.** One sender per chain and key at a time, under a Redis lock; the nonce is the
 *   higher of the chain's pending count and the ledger's in-flight transactions, and a partial
 *   unique index stops two rows claiming one nonce if the lock is ever held twice.
 * - **Write-ahead.** The signed transaction is stored before it is broadcast. After a crash it is
 *   rebroadcast unchanged, so a nonce is never lost or used twice.
 * - **Idempotence.** One transaction in flight per intent (kind and ref); sending again returns it.
 * - **Stuck transactions** are resent with higher fees at the same nonce; one whose nonce was
 *   taken by another transaction is marked DROPPED so its owner can send again.
 */
@Injectable()
export class TxEngine {
  private readonly logger = new Logger(TxEngine.name);

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CHAIN_RPC) private readonly rpcs: ChainRpcFactory,
    private readonly keyring: Keyring,
  ) {}

  /** The latest transaction for an intent, in any status. */
  latest(kind: ChainTxKind, ref: string): Promise<ChainTransaction | null> {
    return this.db.chainTransaction.findFirst({
      where: { kind, ref },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Returns the intent's transaction in flight or mined, or signs, records and broadcasts a new
   * one. Throws ContractRevert when the call would revert, and TxRefused when a node refuses it.
   */
  async send(intent: TxIntent): Promise<ChainTransaction> {
    const existing = await this.current(intent);
    if (existing) return existing;

    const account = this.keyring.sender(intent.sender);
    const from = account.address.toLowerCase() as Address;
    const rpc = this.rpcs(intent.chainId);
    const call = { from, to: intent.to, data: intent.data, value: intent.value ?? 0n };
    await rpc.simulate(call);
    const estimate = await rpc.estimateGas(call);
    const gas = estimate + (estimate * GAS_BUFFER_BPS) / 10_000n;

    return this.withSenderLock(intent.chainId, from, async () => {
      const raced = await this.current(intent);
      if (raced) return raced;

      const fees = await rpc.fees();
      for (let attempt = 0; attempt < 3; attempt++) {
        const nonce = await this.nextNonce(rpc, from);
        const raw = await this.sign(account, rpc, {
          to: call.to,
          data: call.data,
          value: call.value,
          gas,
          nonce,
          fees,
        });
        let row: ChainTransaction;
        try {
          row = await this.db.chainTransaction.create({
            data: {
              chainId: intent.chainId,
              sender: from,
              nonce,
              kind: intent.kind,
              ref: intent.ref,
              to: intent.to.toLowerCase(),
              data: intent.data,
              value: call.value.toString(),
              gasLimit: gas.toString(),
              ...feeColumns(fees),
              raw,
              hashes: [keccak256(raw)],
            },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const inFlight = await this.current(intent);
          if (inFlight) return inFlight;
          continue; // Another sender took the nonce; allocate again.
        }
        this.logger.log(
          `${intent.kind} ${intent.ref} on ${intent.chainId}: nonce ${nonce}, tx ${row.hashes[0]}`,
        );
        return this.broadcast(row, rpc);
      }
      throw new Error(`Could not allocate a nonce for ${from} on chain ${intent.chainId}`);
    });
  }

  /**
   * Follows a transaction until it settles or `timeoutMs` passes, and returns its latest row. A
   * transaction still in flight after the timeout keeps being followed by `reconcile`.
   */
  async waitFor(id: string, timeoutMs = this.env.TX_RECEIPT_TIMEOUT_MS): Promise<ChainTransaction> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let row = await this.db.chainTransaction.findUniqueOrThrow({ where: { id } });
      if (SETTLED.includes(row.status)) return row;
      row = (await this.check(row)) ?? row;
      if (SETTLED.includes(row.status) || Date.now() >= deadline) return row;
      await sleep(POLL_MS);
    }
  }

  /**
   * One pass over transactions in flight: record receipts, rebroadcast any that were signed but
   * may never have left, resend stuck ones with higher fees, and drop those whose nonce was used
   * by something else.
   */
  async reconcile(now = new Date()): Promise<void> {
    const rows = await this.db.chainTransaction.findMany({
      where: { status: { in: IN_FLIGHT } },
      orderBy: [{ chainId: "asc" }, { nonce: "asc" }],
      take: 100,
    });
    for (const row of rows) {
      try {
        await this.reconcileOne(row, now);
      } catch (error) {
        this.logger.warn(`Transaction ${row.id} (${row.kind} ${row.ref}): ${describe(error)}`);
      }
    }
  }

  private async reconcileOne(row: ChainTransaction, now: Date): Promise<void> {
    const rpc = this.rpcs(row.chainId);
    const receipt = await this.check(row);
    if (receipt) return;

    if (row.status === "SIGNED") {
      if (now.getTime() - row.createdAt.getTime() >= REBROADCAST_AFTER_MS) {
        await this.broadcast(row, rpc).catch(() => undefined);
      }
      return;
    }

    const lastSent = row.sentAt ?? row.createdAt;
    if (now.getTime() - lastSent.getTime() < this.env.TX_BUMP_AFTER_MS) return;

    // Nothing of ours was mined at this nonce, yet the account has moved past it.
    if ((await rpc.latestNonce(row.sender as Address)) > row.nonce) {
      await this.settle(row, {
        status: "DROPPED",
        error: `Nonce ${row.nonce} was used by another transaction`,
      });
      this.logger.warn(`${row.kind} ${row.ref}: nonce ${row.nonce} was taken; marked DROPPED`);
      return;
    }

    if (row.hashes.length - 1 >= this.env.TX_MAX_FEE_BUMPS) return;
    const account = this.accountFor(row.sender as Address);
    if (!account) return;
    await this.resend(row, account, rpc);
  }

  /** Records the receipt of any hash sent for this nonce, once it has enough confirmations. */
  private async check(row: ChainTransaction): Promise<ChainTransaction | null> {
    const rpc = this.rpcs(row.chainId);
    const confirmations = BigInt(Math.max(1, findChain(row.chainId)?.confirmations ?? 1));
    for (const hash of [...row.hashes].reverse()) {
      const receipt = await rpc.receipt(hash as Hex);
      if (!receipt) continue;
      const head = await rpc.blockNumber();
      if (head - receipt.blockNumber + 1n < confirmations) return row;
      return this.settle(row, {
        status: receipt.status === "success" ? "MINED" : "REVERTED",
        minedHash: hash,
        blockNumber: receipt.blockNumber,
      });
    }
    return null;
  }

  private async broadcast(row: ChainTransaction, rpc: ChainRpc): Promise<ChainTransaction> {
    try {
      await rpc.sendRawTransaction(row.raw as Hex);
    } catch (error) {
      if (isTransient(error)) {
        // The node may or may not have it. Keep it SIGNED; reconcile rebroadcasts the same bytes.
        throw error;
      }
      const message = describe(error);
      if (/already known|known transaction|already imported|alreadyknown/i.test(message)) {
        return this.markSent(row);
      }
      const settled = await this.check(row);
      if (settled && SETTLED.includes(settled.status)) return settled;
      const status = /nonce too low|nonce has already been used|oldnonce/i.test(message)
        ? "DROPPED"
        : "FAILED";
      await this.settle(row, { status, error: message });
      throw new TxRefused(`${row.kind} ${row.ref} refused: ${message}`);
    }
    return this.markSent(row);
  }

  private async resend(
    row: ChainTransaction,
    account: PrivateKeyAccount,
    rpc: ChainRpc,
  ): Promise<void> {
    const quote = await rpc.fees();
    const fees: FeeQuote =
      row.gasPrice !== null
        ? {
            type: "legacy",
            gasPrice: max(bump(BigInt(row.gasPrice.toFixed())), quoteGasPrice(quote)),
          }
        : {
            type: "eip1559",
            maxFeePerGas: max(bump(BigInt(row.maxFeePerGas!.toFixed())), quoteMaxFee(quote)),
            maxPriorityFeePerGas: max(
              bump(BigInt(row.maxPriorityFeePerGas!.toFixed())),
              quotePriorityFee(quote),
            ),
          };
    const raw = await this.sign(account, rpc, {
      to: row.to as Address,
      data: row.data as Hex,
      value: BigInt(row.value.toFixed()),
      gas: BigInt(row.gasLimit.toFixed()),
      nonce: row.nonce,
      fees,
    });
    const updated = await this.db.chainTransaction.update({
      where: { id: row.id },
      data: { raw, hashes: { push: keccak256(raw) }, ...feeColumns(fees), sentAt: new Date() },
    });
    this.logger.log(
      `${row.kind} ${row.ref}: resent nonce ${row.nonce} with higher fees (${updated.hashes.at(-1)})`,
    );
    await rpc.sendRawTransaction(raw).catch((error: unknown) => {
      this.logger.warn(`${row.kind} ${row.ref}: resend refused: ${describe(error)}`);
    });
  }

  private async sign(
    account: PrivateKeyAccount,
    rpc: ChainRpc,
    tx: { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number; fees: FeeQuote },
  ): Promise<Hex> {
    const base = {
      chainId: rpc.chainId,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gas: tx.gas,
      nonce: tx.nonce,
    };
    return tx.fees.type === "eip1559"
      ? account.signTransaction({
          ...base,
          type: "eip1559",
          maxFeePerGas: tx.fees.maxFeePerGas,
          maxPriorityFeePerGas: tx.fees.maxPriorityFeePerGas,
        })
      : account.signTransaction({ ...base, type: "legacy", gasPrice: tx.fees.gasPrice });
  }

  private async nextNonce(rpc: ChainRpc, from: Address): Promise<number> {
    const [pending, ledger] = await Promise.all([
      rpc.pendingNonce(from),
      this.db.chainTransaction.aggregate({
        _max: { nonce: true },
        where: { chainId: rpc.chainId, sender: from, status: { in: IN_FLIGHT } },
      }),
    ]);
    return Math.max(pending, (ledger._max.nonce ?? -1) + 1);
  }

  private current(intent: TxIntent): Promise<ChainTransaction | null> {
    return this.db.chainTransaction.findFirst({
      where: {
        kind: intent.kind,
        ref: intent.ref,
        chainId: intent.chainId,
        status: { in: [...IN_FLIGHT, "MINED"] },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async markSent(row: ChainTransaction): Promise<ChainTransaction> {
    // Conditional, so a receipt recorded meanwhile is not overwritten.
    await this.db.chainTransaction.updateMany({
      where: { id: row.id, status: "SIGNED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    return this.db.chainTransaction.findUniqueOrThrow({ where: { id: row.id } });
  }

  private async settle(
    row: ChainTransaction,
    data: {
      status: ChainTxStatus;
      minedHash?: string;
      blockNumber?: bigint;
      error?: string;
    },
  ): Promise<ChainTransaction> {
    await this.db.chainTransaction.updateMany({
      where: { id: row.id, status: { in: IN_FLIGHT } },
      data: { ...data, settledAt: new Date() },
    });
    return this.db.chainTransaction.findUniqueOrThrow({ where: { id: row.id } });
  }

  private accountFor(address: Address): PrivateKeyAccount | null {
    const keys = [this.keyring.operator, this.keyring.relayer];
    return keys.find((key) => key?.address.toLowerCase() === address) ?? null;
  }

  private async withSenderLock<T>(
    chainId: number,
    sender: Address,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lease = new Lease(this.redis, `fd:tx-lock:${chainId}:${sender}`, WORKER_ID, LOCK_TTL_MS);
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (!(await lease.acquire())) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting to send from ${sender}`);
      await sleep(100 + Math.floor(Math.random() * 100));
    }
    try {
      return await fn();
    } finally {
      await lease.release().catch(() => undefined);
    }
  }
}

function feeColumns(fees: FeeQuote) {
  return fees.type === "eip1559"
    ? {
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
        gasPrice: null,
      }
    : { gasPrice: fees.gasPrice.toString(), maxFeePerGas: null, maxPriorityFeePerGas: null };
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function quoteGasPrice(quote: FeeQuote): bigint {
  return quote.type === "legacy" ? quote.gasPrice : quote.maxFeePerGas;
}

function quoteMaxFee(quote: FeeQuote): bigint {
  return quote.type === "eip1559" ? quote.maxFeePerGas : quote.gasPrice;
}

function quotePriorityFee(quote: FeeQuote): bigint {
  return quote.type === "eip1559" ? quote.maxPriorityFeePerGas : 0n;
}
