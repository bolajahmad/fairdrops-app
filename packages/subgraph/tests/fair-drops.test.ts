import { afterEach, assert, clearStore, describe, test } from "matchstick-as/assembly/index";
import {
  eventId,
  handleClaimed,
  handleFundsAdded,
  handleGiveawayCancelled,
  handleGiveawayCreated,
  handleGiveawayExpired,
  handleGiveawayFinalized,
  handleHostWithdrawal,
  handleRoleGranted,
  handleSeedCommitted,
} from "../src/fair-drops";
import {
  GIVEAWAY_ID,
  HASH_A,
  HASH_B,
  HOST,
  PAYOUT_WALLET,
  WINNER,
  createClaimed,
  createFundsAdded,
  createGiveawayCancelled,
  createGiveawayCreated,
  createGiveawayExpired,
  createGiveawayFinalized,
  createHostWithdrawal,
  createRoleGranted,
  createSeedCommitted,
} from "./fair-drops-utils";

const GIVEAWAY = GIVEAWAY_ID.toHexString();

afterEach(() => {
  clearStore();
});

describe("eventId", () => {
  test("encodes block number and log index big-endian", () => {
    const event = createSeedCommitted(0x0102, 0x03);
    assert.stringEquals(eventId(event).toHexString(), "0x000000000000010200000003");
  });

  test("sorts in chain order", () => {
    const earlier = eventId(createSeedCommitted(255, 900)).toHexString();
    const later = eventId(createSeedCommitted(256, 0)).toHexString();
    assert.assertTrue(earlier < later);
  });
});

describe("GiveawayCreated", () => {
  test("creates the giveaway and its event row", () => {
    const event = createGiveawayCreated(10, 4, 990, 10);
    handleGiveawayCreated(event);

    assert.entityCount("Giveaway", 1);
    assert.fieldEquals("Giveaway", GIVEAWAY, "status", "ACTIVE");
    assert.fieldEquals("Giveaway", GIVEAWAY, "host", HOST.toHexString());
    assert.fieldEquals("Giveaway", GIVEAWAY, "prize", "990");
    assert.fieldEquals("Giveaway", GIVEAWAY, "fee", "10");
    assert.fieldEquals("Giveaway", GIVEAWAY, "maxWinners", "3");
    assert.fieldEquals("Giveaway", GIVEAWAY, "claimed", "0");
    assert.fieldEquals("Giveaway", GIVEAWAY, "createdAtBlock", "10");

    const row = eventId(event).toHexString();
    assert.fieldEquals("FairDropsEvent", row, "kind", "GiveawayCreated");
    assert.fieldEquals("FairDropsEvent", row, "giveaway", GIVEAWAY);
    assert.fieldEquals("FairDropsEvent", row, "blockNumber", "10");
    assert.fieldEquals("FairDropsEvent", row, "logIndex", "4");
    assert.fieldEquals("FairDropsEvent", row, "metadataHash", HASH_A.toHexString());
    assert.fieldEquals("FairDropsEvent", row, "startTime", "1790000600");
  });
});

describe("giveaway lifecycle", () => {
  test("tracks top-ups, the seed, finalization, claims and withdrawals", () => {
    handleGiveawayCreated(createGiveawayCreated(10, 0, 990, 10));
    handleFundsAdded(createFundsAdded(11, 0, 495, 5));
    handleSeedCommitted(createSeedCommitted(12, 0));
    handleGiveawayFinalized(createGiveawayFinalized(20, 0, 1000));
    handleClaimed(createClaimed(21, 0, 600));
    handleHostWithdrawal(createHostWithdrawal(22, 0, 485));

    assert.fieldEquals("Giveaway", GIVEAWAY, "prize", "1485");
    assert.fieldEquals("Giveaway", GIVEAWAY, "fee", "15");
    assert.fieldEquals("Giveaway", GIVEAWAY, "seedCommitment", HASH_B.toHexString());
    assert.fieldEquals("Giveaway", GIVEAWAY, "status", "FINALIZED");
    assert.fieldEquals("Giveaway", GIVEAWAY, "totalPayout", "1000");
    assert.fieldEquals("Giveaway", GIVEAWAY, "winnerCount", "2");
    assert.fieldEquals("Giveaway", GIVEAWAY, "seed", HASH_B.toHexString());
    assert.fieldEquals("Giveaway", GIVEAWAY, "claimDeadline", "1792592000");
    assert.fieldEquals("Giveaway", GIVEAWAY, "claimed", "600");
    assert.fieldEquals("Giveaway", GIVEAWAY, "withdrawn", "485");

    assert.entityCount("FairDropsEvent", 6);
    const claim = eventId(createClaimed(21, 0, 600)).toHexString();
    assert.fieldEquals("FairDropsEvent", claim, "kind", "Claimed");
    assert.fieldEquals("FairDropsEvent", claim, "account", WINNER.toHexString());
    assert.fieldEquals("FairDropsEvent", claim, "recipient", PAYOUT_WALLET.toHexString());
    assert.fieldEquals("FairDropsEvent", claim, "amount", "600");
  });

  test("marks a cancelled giveaway", () => {
    handleGiveawayCreated(createGiveawayCreated(10, 0, 990, 10));
    handleGiveawayCancelled(createGiveawayCancelled(11, 0));

    assert.fieldEquals("Giveaway", GIVEAWAY, "status", "CANCELLED");
    const row = eventId(createGiveawayCancelled(11, 0)).toHexString();
    assert.fieldEquals("FairDropsEvent", row, "by", HOST.toHexString());
  });

  test("marks an expired giveaway", () => {
    handleGiveawayCreated(createGiveawayCreated(10, 0, 990, 10));
    handleGiveawayExpired(createGiveawayExpired(50, 1));

    assert.fieldEquals("Giveaway", GIVEAWAY, "status", "EXPIRED");
  });
});

describe("protocol events", () => {
  test("records role changes without a giveaway", () => {
    const event = createRoleGranted(5, 2);
    handleRoleGranted(event);

    const row = eventId(event).toHexString();
    assert.fieldEquals("FairDropsEvent", row, "kind", "RoleGranted");
    assert.fieldEquals("FairDropsEvent", row, "role", HASH_A.toHexString());
    assert.fieldEquals("FairDropsEvent", row, "account", WINNER.toHexString());
    assert.fieldEquals("FairDropsEvent", row, "sender", HOST.toHexString());
    assert.entityCount("Giveaway", 0);
  });
});
