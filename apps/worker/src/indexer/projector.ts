import type { OnchainStatus, Prisma } from "@fairdrops/db";
import { decodeGiveawayMetadata, type Address, type Hex } from "@fairdrops/shared";
import { hexToBytes, keccak256 } from "viem";
import type { FairDropsEvent } from "./events.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type Tx = Prisma.TransactionClient;

/**
 * The event does not fit the state already stored, so the copied history is wrong or
 * incomplete. Retrying cannot fix this; the chain's sync halts for an operator.
 */
export class ProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionError";
  }
}

export interface ProjectionTarget {
  chainId: number;
  contractAddress: Address;
}

/**
 * Applies one event to the on-chain tables. Called in chain order inside the transaction that
 * advances the cursor, so each event is applied exactly once. Status changes are conditional
 * on the status the contract requires for that event, as the contract enforces them.
 */
export async function applyEvent(
  tx: Tx,
  target: ProjectionTarget,
  event: FairDropsEvent,
): Promise<void> {
  const { chainId } = target;

  switch (event.kind) {
    case "GiveawayCreated": {
      if (keccak256(event.metadata) !== event.metadataHash) {
        throw new ProjectionError(
          `Giveaway ${event.giveawayId}: metadata does not hash to metadataHash`,
        );
      }
      const decoded = decodeGiveawayMetadata(event.metadata);
      await tx.giveaway.create({
        data: {
          chainId,
          giveawayId: event.giveawayId,
          contractAddress: target.contractAddress,
          host: event.host,
          token: event.token,
          prize: event.prize.toString(),
          fee: event.fee.toString(),
          startTime: event.startTime,
          finalizeDeadline: event.finalizeDeadline,
          maxWinners: event.maxWinners,
          claimWindowSeconds: event.claimWindowSeconds,
          metadataHash: event.metadataHash,
          metadataRaw: new Uint8Array(hexToBytes(event.metadata)),
          metadata: decoded.ok ? (decoded.metadata as Prisma.InputJsonValue) : undefined,
          metadataError: decoded.ok ? null : decoded.error,
          createdBlock: event.blockNumber,
          createdTxHash: event.transactionHash,
          createdAt: event.timestamp,
          updatedBlock: event.blockNumber,
        },
      });
      await recordEvent(tx, target, event, "CREATED", {
        account: event.host,
        amount: event.prize,
        fee: event.fee,
      });
      return;
    }

    case "FundsAdded":
      await updateGiveaway(tx, target, event, ["ACTIVE"], {
        prize: { increment: event.prizeAdded.toString() },
        fee: { increment: event.feeAdded.toString() },
      });
      await recordEvent(tx, target, event, "FUNDS_ADDED", {
        account: event.from,
        amount: event.prizeAdded,
        fee: event.feeAdded,
      });
      return;

    case "SeedCommitted":
      await updateGiveaway(
        tx,
        target,
        event,
        ["ACTIVE"],
        { seedCommitment: event.commitment },
        { seedCommitment: null },
      );
      await recordEvent(tx, target, event, "SEED_COMMITTED", {});
      return;

    case "GiveawayFinalized":
      await updateGiveaway(tx, target, event, ["ACTIVE"], {
        status: "FINALIZED",
        payoutRoot: event.payoutRoot,
        totalPayout: event.totalPayout.toString(),
        winnerCount: event.winnerCount,
        seed: event.seed,
        transcriptHash: event.transcriptHash,
        claimDeadline: event.claimDeadline,
      });
      await recordEvent(tx, target, event, "FINALIZED", { amount: event.totalPayout });
      return;

    case "GiveawayCancelled":
      await updateGiveaway(tx, target, event, ["ACTIVE"], { status: "CANCELLED" });
      await recordEvent(tx, target, event, "CANCELLED", { account: event.by });
      return;

    case "GiveawayExpired":
      await updateGiveaway(tx, target, event, ["ACTIVE"], { status: "EXPIRED" });
      await recordEvent(tx, target, event, "EXPIRED", {});
      return;

    case "Claimed":
      await updateGiveaway(tx, target, event, ["FINALIZED"], {
        claimed: { increment: event.amount.toString() },
      });
      await recordEvent(tx, target, event, "CLAIMED", {
        account: event.account,
        recipient: event.recipient,
        amount: event.amount,
      });
      return;

    case "HostWithdrawal":
      await updateGiveaway(tx, target, event, ["FINALIZED", "CANCELLED", "EXPIRED"], {
        withdrawn: { increment: event.amount.toString() },
      });
      await recordEvent(tx, target, event, "HOST_WITHDRAWAL", {
        account: event.host,
        recipient: event.recipient,
        amount: event.amount,
      });
      return;

    case "PayoutWalletSet": {
      const key = { chainId, contractAddress: target.contractAddress, account: event.account };
      if (event.wallet === ZERO_ADDRESS) {
        await tx.payoutWallet.deleteMany({ where: key });
        return;
      }
      const data = {
        wallet: event.wallet,
        updatedBlock: event.blockNumber,
        updatedAt: event.timestamp,
      };
      await tx.payoutWallet.upsert({
        where: { chainId_contractAddress_account: key },
        create: { ...key, ...data },
        update: data,
      });
      return;
    }

    case "Other":
      return;
  }
}

/**
 * Updates a giveaway only if it is in one of `statuses` (and matches `where`), which is what the
 * contract required for the event to be emitted. Anything else means an event is missing.
 */
async function updateGiveaway(
  tx: Tx,
  target: ProjectionTarget,
  event: FairDropsEvent & { giveawayId: Hex },
  statuses: OnchainStatus[],
  data: Prisma.GiveawayUpdateManyMutationInput,
  where: Prisma.GiveawayWhereInput = {},
): Promise<void> {
  const { count } = await tx.giveaway.updateMany({
    where: {
      ...where,
      chainId: target.chainId,
      giveawayId: event.giveawayId,
      status: { in: statuses },
    },
    data: { ...data, updatedBlock: event.blockNumber },
  });
  if (count === 1) return;

  const current = await tx.giveaway.findUnique({
    where: { chainId_giveawayId: { chainId: target.chainId, giveawayId: event.giveawayId } },
    select: { status: true, seedCommitment: true },
  });
  const found = current
    ? `status ${current.status}${current.seedCommitment ? ", seed committed" : ""}`
    : "no such giveaway";
  throw new ProjectionError(
    `${event.kind} at ${event.blockNumber}:${event.logIndex} does not apply to giveaway ` +
      `${event.giveawayId} (${found}; expected ${statuses.join(" or ")})`,
  );
}

async function recordEvent(
  tx: Tx,
  target: ProjectionTarget,
  event: FairDropsEvent & { giveawayId: Hex },
  kind: Prisma.GiveawayEventCreateManyInput["kind"],
  fields: { account?: Address; recipient?: Address; amount?: bigint; fee?: bigint },
): Promise<void> {
  await tx.giveawayEvent.create({
    data: {
      chainId: target.chainId,
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
      giveawayId: event.giveawayId,
      kind,
      blockHash: event.blockHash,
      transactionHash: event.transactionHash,
      timestamp: event.timestamp,
      account: fields.account,
      recipient: fields.recipient,
      amount: fields.amount?.toString(),
      fee: fields.fee?.toString(),
    },
  });
}
