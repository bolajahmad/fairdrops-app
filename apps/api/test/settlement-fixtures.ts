import type { Prisma } from "@fairdrops/db";
import { Rng, dice, hostedTranscriptSchema, transcriptHash } from "@fairdrops/game-kit";
import {
  computeSettlement,
  seedCommitment,
  settlementDigest,
  settlementMessage,
  settlementTypedData,
} from "@fairdrops/settlement";
import {
  encodeGiveawayMetadata,
  giveawayMetadataSchema,
  rewardPolicyOf,
  type Address,
  type Hex,
} from "@fairdrops/shared";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Database } from "../src/infra/prisma.module.js";
import { CHAIN_ID, HOST } from "./session-fixtures.js";

export const CONTRACT = "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72" as Address;
export const VERIFIER = privateKeyToAccount(keccak256(toHex("api test verifier")));

let counter = 1_000;

export interface SettledOptions {
  players: Address[];
  /** CONFIRMED also marks the giveaway finalized on-chain, as the indexer would. */
  status?: "PROPOSED" | "SIGNED" | "CONFIRMED";
  createdAt?: Date;
  /** The prize token; the chain's native currency by default. */
  token?: Address;
}

/**
 * A giveaway whose dice game was really played (with game-kit, as the runtime does) and whose
 * settlement was computed with @fairdrops/settlement, so everything the API serves about it
 * verifies: the metadata hash, the transcript replay, the payout root and every proof.
 */
export async function createSettledGiveaway(db: Database, options: SettledOptions) {
  counter += 1;
  const giveawayId: Hex = toHex(counter, { size: 32 });
  const now = options.createdAt ?? new Date();
  const metadata = giveawayMetadataSchema.parse({
    v: 2,
    title: "Dice night",
    description: "Two rolls each",
    game: { id: "dice", version: "1.0.0", config: { rolls: 2, windowSeconds: 30 } },
    rewards: { kind: "weighted", bps: [7000, 3000] },
  });
  const encoded = encodeGiveawayMetadata(metadata);
  const seed = keccak256(toHex(`seed ${counter}`));
  const players = [...options.players].map((p) => p.toLowerCase() as Address).sort();
  const startAt = now.getTime() - 120_000;

  const config = dice.config.parse(metadata.game.config);
  const state = dice.init({
    config,
    players,
    startAt,
    rng: Rng.fromSeed(seed),
    resources: new Map(),
  });
  const actions = players.flatMap((player, p) =>
    [0, 1].map((r) => ({
      player,
      at: startAt + 1_000 * (p * 2 + r + 1),
      action: { type: "roll" },
    })),
  );
  const logged = actions.map((entry, seq) => {
    dice.apply(state, { type: "roll" }, { player: entry.player, seq, at: entry.at });
    return { seq, ...entry };
  });
  const sessionId = crypto.randomUUID();
  const transcript = hostedTranscriptSchema.parse({
    v: 1,
    mode: "HOSTED",
    session: { id: sessionId, chainId: CHAIN_ID, contract: CONTRACT, giveawayId },
    game: { id: "dice", version: "1.0.0" },
    config,
    seed,
    startAt,
    endAt: startAt + dice.duration(config),
    players,
    resources: [],
    actions: logged,
    ranking: dice.rank(state),
  });
  const hash = transcriptHash(transcript);

  const prize = 1_000_000n;
  const computed = computeSettlement({
    giveawayId,
    ranking: transcript.ranking,
    policy: rewardPolicyOf(metadata, 3),
    prize,
  })!;
  const message = settlementMessage(giveawayId, computed, seed, hash);
  const confirmed = options.status === "CONFIRMED";
  const claimDeadline = new Date(now.getTime() + 30 * 86_400_000);

  await db.giveaway.create({
    data: {
      chainId: CHAIN_ID,
      giveawayId,
      contractAddress: CONTRACT,
      host: HOST,
      token: options.token ?? "0x0000000000000000000000000000000000000000",
      prize: prize.toString(),
      fee: "10000",
      startTime: new Date(startAt),
      finalizeDeadline: new Date(now.getTime() + 86_400_000),
      maxWinners: 3,
      claimWindowSeconds: 2_592_000,
      metadataHash: keccak256(encoded.hex),
      metadataRaw: new Uint8Array(encoded.bytes),
      metadata: metadata as Prisma.InputJsonValue,
      seedCommitment: seedCommitment(giveawayId, seed),
      createdBlock: 1n,
      createdTxHash: `0x${"b".repeat(64)}`,
      createdAt: now,
      updatedBlock: 1n,
      ...(confirmed
        ? {
            status: "FINALIZED",
            payoutRoot: computed.payoutRoot,
            totalPayout: computed.totalPayout.toString(),
            winnerCount: computed.winnerCount,
            seed,
            transcriptHash: hash,
            claimDeadline,
          }
        : {}),
    },
  });

  await db.gameSession.create({
    data: {
      id: sessionId,
      chainId: CHAIN_ID,
      giveawayId,
      gameId: "dice",
      gameVersion: "1.0.0",
      mode: "HOSTED",
      status: confirmed ? "FINALIZED" : "SETTLING",
      config,
      seedCiphertext: new Uint8Array(60),
      seedCommitment: seedCommitment(giveawayId, seed),
      seed,
      startsAt: new Date(startAt),
      endsAt: new Date(transcript.endAt),
      startedAt: new Date(startAt),
      endedAt: new Date(transcript.endAt),
      ranking: transcript.ranking,
      transcriptHash: hash,
      transcript: { create: { hash, content: transcript as Prisma.InputJsonValue } },
    },
  });

  const signature = await VERIFIER.signTypedData(settlementTypedData(CHAIN_ID, CONTRACT, message));
  await db.settlement.create({
    data: {
      sessionId,
      chainId: CHAIN_ID,
      giveawayId,
      status: options.status ?? "PROPOSED",
      policy: rewardPolicyOf(metadata, 3),
      prize: prize.toString(),
      payoutRoot: computed.payoutRoot,
      totalPayout: computed.totalPayout.toString(),
      winnerCount: computed.winnerCount,
      seed,
      transcriptHash: hash,
      digest: settlementDigest(CHAIN_ID, CONTRACT, message),
      tree: computed.tree.dump(),
      confirmedAt: confirmed ? now : null,
      payouts: {
        create: computed.payouts.map((payout) => ({
          account: payout.account,
          amount: payout.amount.toString(),
          rank: payout.rank,
          proof: computed.tree.proofOf(payout.account)!,
        })),
      },
      signatures: {
        create: [{ verifier: VERIFIER.address.toLowerCase(), signature }],
      },
    },
  });

  return { giveawayId, sessionId, transcript, computed, seed, message, claimDeadline };
}
