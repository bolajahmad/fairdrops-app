import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Address, Hex } from "@fairdrops/shared";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";

/** Which key sends a transaction. */
export type SenderRole = "operator" | "relayer";

function account(key: string): PrivateKeyAccount {
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

/**
 * The worker's keys, each with one job:
 * - operator (OPERATOR_ROLE): commits seeds and cancels giveaways whose game failed;
 * - relayer: pays gas for finalize and relayed claims, and holds no role;
 * - verifiers (VERIFIER_ROLE): sign settlements they have checked, and never send transactions.
 */
@Injectable()
export class Keyring {
  readonly operator: PrivateKeyAccount | null;
  readonly relayer: PrivateKeyAccount | null;
  readonly verifiers: PrivateKeyAccount[];

  constructor(@Inject(WORKER_ENV) env: WorkerEnv) {
    this.operator = env.OPERATOR_PRIVATE_KEY ? account(env.OPERATOR_PRIVATE_KEY) : null;
    this.relayer = env.RELAYER_PRIVATE_KEY ? account(env.RELAYER_PRIVATE_KEY) : this.operator;
    this.verifiers = env.VERIFIER_PRIVATE_KEYS.map(account);

    const logger = new Logger(Keyring.name);
    if (!env.RELAYER_PRIVATE_KEY && this.operator && env.SETTLEMENT_ENABLED) {
      logger.warn("RELAYER_PRIVATE_KEY is not set; the operator key pays for finalize and claims");
    }
  }

  sender(role: SenderRole): PrivateKeyAccount {
    const key = role === "operator" ? this.operator : this.relayer;
    if (!key) {
      throw new Error(
        role === "operator"
          ? "OPERATOR_PRIVATE_KEY is not set"
          : "Neither RELAYER_PRIVATE_KEY nor OPERATOR_PRIVATE_KEY is set",
      );
    }
    return key;
  }

  /** Every address that pays gas, for balance checks. */
  payers(): Address[] {
    const payers = [this.operator, this.relayer]
      .filter((key): key is PrivateKeyAccount => key !== null)
      .map((key) => key.address.toLowerCase() as Address);
    return [...new Set(payers)];
  }
}
