import type { GameMode, SessionStatus } from "@fairdrops/db";
import type { Address, Hex } from "@fairdrops/shared";
import { toHex } from "viem";
import type { Database } from "../src/infra/prisma.module.js";

export const CHAIN_ID = 84532;
export const HOST = "0x00000000000000000000000000000000000000a1" as Address;

let counter = 0;

export interface SessionOptions {
  status?: SessionStatus;
  mode?: GameMode;
  gameId?: string;
  startsIn?: number;
  endsIn?: number;
}

/** Inserts a giveaway and its session as the indexer and the worker would. */
export async function createSession(db: Database, options: SessionOptions = {}) {
  counter += 1;
  const giveawayId: Hex = toHex(counter, { size: 32 });
  const now = Date.now();
  const startsAt = new Date(now + (options.startsIn ?? 60_000));
  const status = options.status ?? "SEED_COMMITTED";
  const running = ["RUNNING", "SETTLING", "FINALIZING", "FINALIZED"].includes(status);
  const ended = ["SETTLING", "FINALIZING", "FINALIZED"].includes(status);

  await db.giveaway.create({
    data: {
      chainId: CHAIN_ID,
      giveawayId,
      contractAddress: "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72",
      host: HOST,
      token: "0x0000000000000000000000000000000000000000",
      prize: "1000",
      fee: "10",
      startTime: startsAt,
      finalizeDeadline: new Date(now + 24 * 60 * 60_000),
      maxWinners: 3,
      claimWindowSeconds: 2_592_000,
      metadataHash: `0x${"a".repeat(64)}`,
      metadataRaw: new Uint8Array([123, 125]),
      metadata: {},
      createdBlock: 1n,
      createdTxHash: `0x${"b".repeat(64)}`,
      createdAt: new Date(now),
      updatedBlock: 1n,
    },
  });

  return db.gameSession.create({
    data: {
      chainId: CHAIN_ID,
      giveawayId,
      gameId: options.gameId ?? "dice",
      gameVersion: "1.0.0",
      mode: options.mode ?? "HOSTED",
      status,
      failureReason: status === "FAILED" || status === "CANCELLED" ? "test" : null,
      config: { rolls: 3, dice: 2, sides: 6, windowSeconds: 30 },
      seedCiphertext: new Uint8Array(60),
      seedCommitment: `0x${"c".repeat(64)}`,
      seed: ended ? `0x${"d".repeat(64)}` : null,
      startsAt,
      endsAt: new Date(now + (options.endsIn ?? 60 * 60_000)),
      startedAt: running ? new Date(now) : null,
      endedAt: ended ? new Date(now) : null,
      ranking: ended ? [{ player: HOST, score: 7, rank: 1 }] : undefined,
      transcriptHash: ended ? `0x${"e".repeat(64)}` : null,
    },
  });
}

export async function addPlayer(db: Database, sessionId: string, wallet: Address): Promise<void> {
  const user = await db.user.create({ data: {} });
  await db.sessionParticipant.create({ data: { sessionId, wallet, userId: user.id } });
}
