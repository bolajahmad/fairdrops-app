import { describe, expect, it } from "vitest";
import { MalformedEventError, rawEventSchema, toEvent } from "./events.js";

const position = {
  id: "0x000000000000006400000002",
  blockNumber: "100",
  blockHash: `0x${"a".repeat(64)}`,
  timestamp: "1790000000",
  transactionHash: `0x${"b".repeat(64)}`,
  logIndex: "2",
};

describe("toEvent", () => {
  it("converts a subgraph row into a typed event", () => {
    const raw = rawEventSchema.parse({
      ...position,
      kind: "Claimed",
      giveaway: { id: `0x${"1".repeat(64)}` },
      account: "0x00000000000000000000000000000000000000b2",
      recipient: "0x00000000000000000000000000000000000000c3",
      amount: "600",
      host: null,
    });

    expect(toEvent(raw)).toEqual({
      id: position.id,
      kind: "Claimed",
      blockNumber: 100n,
      logIndex: 2,
      blockHash: position.blockHash,
      transactionHash: position.transactionHash,
      timestamp: new Date(1_790_000_000_000),
      giveawayId: `0x${"1".repeat(64)}`,
      account: "0x00000000000000000000000000000000000000b2",
      recipient: "0x00000000000000000000000000000000000000c3",
      amount: 600n,
    });
  });

  it("rejects an event missing a parameter its kind requires", () => {
    const raw = rawEventSchema.parse({ ...position, kind: "GiveawayExpired" });
    expect(() => toEvent(raw)).toThrow(MalformedEventError);
  });

  it("passes other events through without projecting them", () => {
    const raw = rawEventSchema.parse({ ...position, kind: "FeeBpsUpdated" });
    expect(toEvent(raw)).toMatchObject({ kind: "Other", name: "FeeBpsUpdated" });
  });

  it("rejects checksummed or malformed values from the subgraph", () => {
    expect(
      rawEventSchema.safeParse({
        ...position,
        kind: "PayoutWalletSet",
        account: "0x00000000000000000000000000000000000000B2",
      }).success,
    ).toBe(false);
    expect(rawEventSchema.safeParse({ ...position, kind: "X", blockNumber: "-1" }).success).toBe(
      false,
    );
  });
});
