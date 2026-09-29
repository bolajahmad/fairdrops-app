/**
 * Checks a giveaway's result independently: nothing FairDrops says is taken on trust. The chain
 * supplies the prize, the seed commitment, the metadata hash and the settled result; FairDrops
 * only supplies public documents (the metadata, the transcript, the payout tree), each of which
 * is checked against a hash on-chain before it is used.
 */
import { fairDropsAbi } from "@fairdrops/contracts";
import {
  PayoutTree,
  verifySettlement,
  type SettlementMessage,
  type VerificationCheck,
} from "@fairdrops/settlement";
import { decodeGiveawayMetadata, type Address, type Hex } from "@fairdrops/shared";
import { keccak256, type PublicClient } from "viem";
import type { FairDrops } from "./client.js";
import { publicClientFor } from "./chain.js";

export type { VerificationCheck } from "@fairdrops/settlement";

const STATUSES = ["None", "Active", "Finalized", "Cancelled", "Expired"] as const;
const ZERO: Hex = `0x${"0".repeat(64)}`;

export interface VerifyGiveawayOptions {
  /** Defaults to a client over the chain's public RPC. Pass your own node to trust nothing else. */
  publicClient?: PublicClient;
}

export interface GiveawayVerification {
  ok: boolean;
  /** What was checked: the settlement on-chain once finalized, the signed proposal before. */
  against: "onchain" | "proposal";
  status: (typeof STATUSES)[number];
  checks: (VerificationCheck | { name: "metadata" | "payoutTree"; ok: boolean; detail: string })[];
}

/**
 * Verifies a giveaway's result. Once finalized, it checks what the contract recorded; before
 * that, the settlement FairDrops proposed. Every check is listed with what it found.
 */
export async function verifyGiveaway(
  fd: FairDrops,
  chainId: number,
  giveawayId: Hex,
  options: VerifyGiveawayOptions = {},
): Promise<GiveawayVerification> {
  const client = options.publicClient ?? publicClientFor(chainId);
  const view = await fd.giveaways.get(chainId, giveawayId);
  const contract = view.contract;
  const onchain = await client.readContract({
    address: contract,
    abi: fairDropsAbi,
    functionName: "getGiveaway",
    args: [giveawayId],
  });
  const status = STATUSES[onchain.status] ?? "None";
  const checks: GiveawayVerification["checks"] = [];

  // The metadata is only trusted because its hash is on-chain.
  const metadataOk = keccak256(view.metadataHex) === onchain.metadataHash;
  checks.push({
    name: "metadata",
    ok: metadataOk,
    detail: metadataOk
      ? "The host's metadata matches the hash escrowed with the prize"
      : "The metadata FairDrops serves does not match the on-chain hash",
  });
  const decoded = decodeGiveawayMetadata(view.metadataHex);
  if (!metadataOk || !decoded.ok) {
    return { ok: false, against: "onchain", status, checks };
  }

  const session = await fd.sessions.byGiveaway(chainId, giveawayId);
  const transcript = await fd.sessions.transcript(session.id);
  const finalized = status === "Finalized";

  let message: SettlementMessage;
  let tree: PayoutTree | null = null;
  if (finalized) {
    if (!session.seed) throw new Error("The session has not revealed its seed");
    message = {
      giveawayId,
      payoutRoot: onchain.payoutRoot,
      totalPayout: onchain.totalPayout,
      winnerCount: Number(onchain.winnerCount),
      seed: session.seed,
      transcriptHash: onchain.transcriptHash,
    };
  } else {
    const settlement = await fd.settlement.get(session.id);
    message = {
      giveawayId,
      payoutRoot: settlement.payoutRoot,
      totalPayout: BigInt(settlement.totalPayout),
      winnerCount: settlement.winnerCount,
      seed: settlement.seed,
      transcriptHash: settlement.transcriptHash,
    };
  }

  let reporter: Address | undefined;
  if (session.game.mode === "EXTERNAL") {
    const game = await fd.games.get(session.game.id, session.game.version);
    reporter = game.reporterAddress ?? undefined;
  }

  const result = await verifySettlement({
    chainId,
    contract,
    giveawayId,
    giveaway: {
      prize: onchain.prize,
      maxWinners: Number(onchain.maxWinners),
      seedCommitment: onchain.seedCommitment === ZERO ? ZERO : onchain.seedCommitment,
    },
    metadata: decoded.metadata,
    transcript,
    settlement: message,
    reporter,
  });
  checks.push(...result.checks);

  // The published tree must be the one the root commits to, so claims work for every winner.
  try {
    tree = PayoutTree.load(await fd.settlement.payoutTree(session.id));
    const treeOk = tree.root === message.payoutRoot.toLowerCase();
    checks.push({
      name: "payoutTree",
      ok: treeOk,
      detail: treeOk
        ? `The published payout tree has ${tree.size} leaves under the settled root`
        : "The published payout tree does not match the settled root",
    });
  } catch (error) {
    checks.push({ name: "payoutTree", ok: false, detail: (error as Error).message });
  }

  return {
    ok: checks.every((check) => check.ok),
    against: finalized ? "onchain" : "proposal",
    status,
    checks,
  };
}
