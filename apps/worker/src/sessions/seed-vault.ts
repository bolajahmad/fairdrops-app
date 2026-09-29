import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Hex } from "@fairdrops/shared";
import { encodeAbiParameters, keccak256 } from "viem";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Creates session seeds and keeps them encrypted at rest (AES-256-GCM). A seed is secret until
 * its game is over: anyone who knew it early could predict the dice or the question order.
 */
@Injectable()
export class SeedVault {
  private readonly key: Buffer;

  constructor(@Inject(WORKER_ENV) env: WorkerEnv) {
    if (env.SESSION_SEED_KEY) {
      this.key = Buffer.from(env.SESSION_SEED_KEY.replace(/^0x/, ""), "hex");
    } else {
      new Logger(SeedVault.name).warn(
        "SESSION_SEED_KEY is not set; seeds are encrypted with a fixed development key",
      );
      this.key = createHash("sha256").update("fairdrops insecure development seed key").digest();
    }
  }

  generate(): Hex {
    return `0x${randomBytes(32).toString("hex")}`;
  }

  encrypt(seed: Hex): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(Buffer.from(seed.slice(2), "hex")), cipher.final()]);
    return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  decrypt(sealed: Uint8Array): Hex {
    const data = Buffer.from(sealed);
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, IV_BYTES));
    decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const seed = Buffer.concat([
      decipher.update(data.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
    return `0x${seed.toString("hex")}`;
  }
}

/** The value `commitSeed` takes: keccak256(abi.encode(giveawayId, seed)). */
export function seedCommitment(giveawayId: Hex, seed: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [giveawayId, seed]),
  );
}
