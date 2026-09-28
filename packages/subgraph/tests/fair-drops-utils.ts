import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as/assembly/index";
import {
  Claimed,
  FundsAdded,
  GiveawayCancelled,
  GiveawayCreated,
  GiveawayExpired,
  GiveawayFinalized,
  HostWithdrawal,
  RoleGranted,
  SeedCommitted,
} from "../generated/FairDrops/FairDrops";

export const GIVEAWAY_ID = Bytes.fromHexString(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
export const HOST = Address.fromString("0x00000000000000000000000000000000000000a1");
export const TOKEN = Address.fromString("0x0000000000000000000000000000000000000000");
export const WINNER = Address.fromString("0x00000000000000000000000000000000000000b2");
export const PAYOUT_WALLET = Address.fromString("0x00000000000000000000000000000000000000c3");
export const HASH_A = Bytes.fromHexString(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
export const HASH_B = Bytes.fromHexString(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);

function at(event: ethereum.Event, block: i32, logIndex: i32): void {
  event.block.number = BigInt.fromI32(block);
  event.block.timestamp = BigInt.fromI32(1_790_000_000 + block);
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = new Array();
}

function bytes32(name: string, value: Bytes): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromFixedBytes(value));
}

function address(name: string, value: Address): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromAddress(value));
}

function uint(name: string, value: i64): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromUnsignedBigInt(BigInt.fromI64(value)));
}

export function createGiveawayCreated(
  block: i32,
  logIndex: i32,
  prize: i64,
  fee: i64,
): GiveawayCreated {
  const event = changetype<GiveawayCreated>(newMockEvent());
  at(event, block, logIndex);
  event.parameters.push(bytes32("id", GIVEAWAY_ID));
  event.parameters.push(address("host", HOST));
  event.parameters.push(address("token", TOKEN));
  event.parameters.push(uint("prize", prize));
  event.parameters.push(uint("fee", fee));
  event.parameters.push(uint("startTime", 1_790_000_600));
  event.parameters.push(uint("finalizeDeadline", 1_790_086_400));
  event.parameters.push(uint("maxWinners", 3));
  event.parameters.push(uint("claimWindow", 2_592_000));
  event.parameters.push(bytes32("metadataHash", HASH_A));
  event.parameters.push(
    new ethereum.EventParam(
      "metadata",
      ethereum.Value.fromBytes(Bytes.fromUTF8('{"title":"Test"}')),
    ),
  );
  return event;
}

export function createFundsAdded(
  block: i32,
  logIndex: i32,
  prizeAdded: i64,
  feeAdded: i64,
): FundsAdded {
  const event = changetype<FundsAdded>(newMockEvent());
  at(event, block, logIndex);
  event.parameters.push(bytes32("id", GIVEAWAY_ID));
  event.parameters.push(address("from", HOST));
  event.parameters.push(uint("prizeAdded", prizeAdded));
  event.parameters.push(uint("feeAdded", feeAdded));
  return event;
}

export function createSeedCommitted(block: i32, logIndex: i32): SeedCommitted {
  const event = changetype<SeedCommitted>(newMockEvent());
  at(event, block, logIndex);
  event.parameters.push(bytes32("id", GIVEAWAY_ID));
  event.parameters.push(bytes32("commitment", HASH_B));
  return event;
}

export function createGiveawayFinalized(
  block: i32,
  logIndex: i32,
  totalPayout: i64,
): GiveawayFinalized {
  const event = changetype<GiveawayFinalized>(newMockEvent());
  at(event, block, logIndex);
  event.parameters.push(bytes32("id", GIVEAWAY_ID));
  event.parameters.push(bytes32("payoutRoot", HASH_A));
  event.parameters.push(uint("totalPayout", totalPayout));
  event.parameters.push(uint("winnerCount", 2));
  event.parameters.push(bytes32("seed", HASH_B));
  event.parameters.push(bytes32("transcriptHash", HASH_A));
  event.parameters.push(uint("claimDeadline", 1_792_592_000));
  return event;
}

export function createGiveawayCancelled(block: i32, logIndex: i32): GiveawayCancelled {
  const event = changetype<GiveawayCancelled>(newMockEvent());
  at(event, block, logIndex);
  event.parameters.push(bytes32("id", GIVEAWAY_ID));
  event.parameters.push(address("by", HOST));
  return event;
}

export function createGiveawayExpired(block: i32, logIndex: i32): GiveawayExpired {
  const event = changetype<GiveawayExpired>(newMockEvent());
  at(event, block, logIndex);
  event.parameters.push(bytes32("id", GIVEAWAY_ID));
  return event;
}

export function createClaimed(block: i32, logIndex: i32, amount: i64): Claimed {
  const event = changetype<Claimed>(newMockEvent());
  at(event, block, logIndex);
  event.parameters.push(bytes32("id", GIVEAWAY_ID));
  event.parameters.push(address("account", WINNER));
  event.parameters.push(address("recipient", PAYOUT_WALLET));
  event.parameters.push(uint("amount", amount));
  return event;
}

export function createHostWithdrawal(block: i32, logIndex: i32, amount: i64): HostWithdrawal {
  const event = changetype<HostWithdrawal>(newMockEvent());
  at(event, block, logIndex);
  event.parameters.push(bytes32("id", GIVEAWAY_ID));
  event.parameters.push(address("host", HOST));
  event.parameters.push(address("recipient", HOST));
  event.parameters.push(uint("amount", amount));
  return event;
}

export function createRoleGranted(block: i32, logIndex: i32): RoleGranted {
  const event = changetype<RoleGranted>(newMockEvent());
  at(event, block, logIndex);
  event.parameters.push(bytes32("role", HASH_A));
  event.parameters.push(address("account", WINNER));
  event.parameters.push(address("sender", HOST));
  return event;
}
