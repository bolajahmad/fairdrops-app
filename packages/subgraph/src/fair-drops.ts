import { BigInt, ByteArray, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  ClaimWindowUpdated,
  Claimed,
  FeeBpsUpdated,
  FeeRecipientUpdated,
  FeesWithdrawn,
  FundsAdded,
  GiveawayCancelled,
  GiveawayCreated,
  GiveawayExpired,
  GiveawayFinalized,
  HostWithdrawal,
  Paused,
  PayoutWalletSet,
  RoleGranted,
  RoleRevoked,
  SeedCommitted,
  Swept,
  Unpaused,
  VerifierThresholdUpdated,
} from "../generated/FairDrops/FairDrops";
import { FairDropsEvent, Giveaway } from "../generated/schema";

/** Block number and log index, big-endian, so that ordering by id is chain order. */
export function eventId(event: ethereum.Event): Bytes {
  const id = new ByteArray(12);
  const block = event.block.number.toU64();
  const log = event.logIndex.toU32();
  for (let i = 0; i < 8; i++) id[i] = u8((block >> (8 * (7 - i))) & 0xff);
  for (let i = 0; i < 4; i++) id[8 + i] = u8((log >> (8 * (3 - i))) & 0xff);
  return Bytes.fromByteArray(id);
}

function newEvent(event: ethereum.Event, kind: string): FairDropsEvent {
  const row = new FairDropsEvent(eventId(event));
  row.kind = kind;
  row.blockNumber = event.block.number;
  row.blockHash = event.block.hash;
  row.timestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.logIndex = event.logIndex;
  return row;
}

/** Every giveaway event follows its GiveawayCreated, so the entity always exists. */
function loadGiveaway(id: Bytes): Giveaway {
  return Giveaway.load(id)!;
}

// Giveaway lifecycle

export function handleGiveawayCreated(event: GiveawayCreated): void {
  const p = event.params;

  const giveaway = new Giveaway(p.id);
  giveaway.host = p.host;
  giveaway.token = p.token;
  giveaway.prize = p.prize;
  giveaway.fee = p.fee;
  giveaway.startTime = p.startTime;
  giveaway.finalizeDeadline = p.finalizeDeadline;
  giveaway.maxWinners = p.maxWinners;
  giveaway.claimWindow = p.claimWindow;
  giveaway.metadataHash = p.metadataHash;
  giveaway.metadata = p.metadata;
  giveaway.status = "ACTIVE";
  giveaway.totalPayout = BigInt.zero();
  giveaway.winnerCount = BigInt.zero();
  giveaway.claimed = BigInt.zero();
  giveaway.withdrawn = BigInt.zero();
  giveaway.createdAtBlock = event.block.number;
  giveaway.createdAtTimestamp = event.block.timestamp;
  giveaway.createdAtTransaction = event.transaction.hash;
  giveaway.save();

  const row = newEvent(event, "GiveawayCreated");
  row.giveaway = p.id;
  row.host = p.host;
  row.token = p.token;
  row.prize = p.prize;
  row.fee = p.fee;
  row.startTime = p.startTime;
  row.finalizeDeadline = p.finalizeDeadline;
  row.maxWinners = p.maxWinners;
  row.claimWindow = p.claimWindow;
  row.metadataHash = p.metadataHash;
  row.metadata = p.metadata;
  row.save();
}

export function handleFundsAdded(event: FundsAdded): void {
  const p = event.params;

  const giveaway = loadGiveaway(p.id);
  giveaway.prize = giveaway.prize.plus(p.prizeAdded);
  giveaway.fee = giveaway.fee.plus(p.feeAdded);
  giveaway.save();

  const row = newEvent(event, "FundsAdded");
  row.giveaway = p.id;
  row.from = p.from;
  row.prizeAdded = p.prizeAdded;
  row.feeAdded = p.feeAdded;
  row.save();
}

export function handleSeedCommitted(event: SeedCommitted): void {
  const p = event.params;

  const giveaway = loadGiveaway(p.id);
  giveaway.seedCommitment = p.commitment;
  giveaway.save();

  const row = newEvent(event, "SeedCommitted");
  row.giveaway = p.id;
  row.commitment = p.commitment;
  row.save();
}

export function handleGiveawayFinalized(event: GiveawayFinalized): void {
  const p = event.params;

  const giveaway = loadGiveaway(p.id);
  giveaway.status = "FINALIZED";
  giveaway.payoutRoot = p.payoutRoot;
  giveaway.totalPayout = p.totalPayout;
  giveaway.winnerCount = p.winnerCount;
  giveaway.seed = p.seed;
  giveaway.transcriptHash = p.transcriptHash;
  giveaway.claimDeadline = p.claimDeadline;
  giveaway.save();

  const row = newEvent(event, "GiveawayFinalized");
  row.giveaway = p.id;
  row.payoutRoot = p.payoutRoot;
  row.totalPayout = p.totalPayout;
  row.winnerCount = p.winnerCount;
  row.seed = p.seed;
  row.transcriptHash = p.transcriptHash;
  row.claimDeadline = p.claimDeadline;
  row.save();
}

export function handleGiveawayCancelled(event: GiveawayCancelled): void {
  const p = event.params;

  const giveaway = loadGiveaway(p.id);
  giveaway.status = "CANCELLED";
  giveaway.save();

  const row = newEvent(event, "GiveawayCancelled");
  row.giveaway = p.id;
  row.by = p.by;
  row.save();
}

export function handleGiveawayExpired(event: GiveawayExpired): void {
  const p = event.params;

  const giveaway = loadGiveaway(p.id);
  giveaway.status = "EXPIRED";
  giveaway.save();

  const row = newEvent(event, "GiveawayExpired");
  row.giveaway = p.id;
  row.save();
}

export function handleClaimed(event: Claimed): void {
  const p = event.params;

  const giveaway = loadGiveaway(p.id);
  giveaway.claimed = giveaway.claimed.plus(p.amount);
  giveaway.save();

  const row = newEvent(event, "Claimed");
  row.giveaway = p.id;
  row.account = p.account;
  row.recipient = p.recipient;
  row.amount = p.amount;
  row.save();
}

export function handleHostWithdrawal(event: HostWithdrawal): void {
  const p = event.params;

  const giveaway = loadGiveaway(p.id);
  giveaway.withdrawn = giveaway.withdrawn.plus(p.amount);
  giveaway.save();

  const row = newEvent(event, "HostWithdrawal");
  row.giveaway = p.id;
  row.host = p.host;
  row.recipient = p.recipient;
  row.amount = p.amount;
  row.save();
}

// Accounts

export function handlePayoutWalletSet(event: PayoutWalletSet): void {
  const row = newEvent(event, "PayoutWalletSet");
  row.account = event.params.account;
  row.wallet = event.params.wallet;
  row.save();
}

// Treasury and configuration

export function handleFeesWithdrawn(event: FeesWithdrawn): void {
  const row = newEvent(event, "FeesWithdrawn");
  row.token = event.params.token;
  row.recipient = event.params.recipient;
  row.amount = event.params.amount;
  row.save();
}

export function handleSwept(event: Swept): void {
  const row = newEvent(event, "Swept");
  row.token = event.params.token;
  row.to = event.params.to;
  row.amount = event.params.amount;
  row.save();
}

export function handleFeeBpsUpdated(event: FeeBpsUpdated): void {
  const row = newEvent(event, "FeeBpsUpdated");
  row.feeBps = BigInt.fromI32(event.params.feeBps);
  row.save();
}

export function handleFeeRecipientUpdated(event: FeeRecipientUpdated): void {
  const row = newEvent(event, "FeeRecipientUpdated");
  row.feeRecipient = event.params.feeRecipient;
  row.save();
}

export function handleClaimWindowUpdated(event: ClaimWindowUpdated): void {
  const row = newEvent(event, "ClaimWindowUpdated");
  row.claimWindow = event.params.claimWindow;
  row.save();
}

export function handleVerifierThresholdUpdated(event: VerifierThresholdUpdated): void {
  const row = newEvent(event, "VerifierThresholdUpdated");
  row.threshold = BigInt.fromI32(event.params.threshold);
  row.save();
}

// Access control. Indexed so anyone can audit who could sign settlements at any block.

export function handleRoleGranted(event: RoleGranted): void {
  const row = newEvent(event, "RoleGranted");
  row.role = event.params.role;
  row.account = event.params.account;
  row.sender = event.params.sender;
  row.save();
}

export function handleRoleRevoked(event: RoleRevoked): void {
  const row = newEvent(event, "RoleRevoked");
  row.role = event.params.role;
  row.account = event.params.account;
  row.sender = event.params.sender;
  row.save();
}

export function handlePaused(event: Paused): void {
  const row = newEvent(event, "Paused");
  row.account = event.params.account;
  row.save();
}

export function handleUnpaused(event: Unpaused): void {
  const row = newEvent(event, "Unpaused");
  row.account = event.params.account;
  row.save();
}
