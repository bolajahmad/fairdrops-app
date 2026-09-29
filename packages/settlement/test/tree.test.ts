import { payoutTreeDumpSchema, type Address, type Hex } from "@fairdrops/shared";
import { describe, expect, it } from "vitest";
import { SettlementError } from "../src/payouts.js";
import { PayoutTree, verifyPayoutProof } from "../src/tree.js";

const ID: Hex = `0x${"ab".repeat(32)}`;
const account = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
const payouts = Array.from({ length: 7 }, (_, i) => ({
  account: account(i + 1),
  amount: BigInt((i + 1) * 1000),
  rank: i + 1,
}));

describe("PayoutTree", () => {
  it("gives every winner a proof that verifies against the root", () => {
    const tree = PayoutTree.build(ID, payouts);
    for (const payout of payouts) {
      const proof = tree.proofOf(payout.account)!;
      expect(verifyPayoutProof(tree.root, ID, payout.account, payout.amount, proof)).toBe(true);
      expect(verifyPayoutProof(tree.root, ID, payout.account, payout.amount + 1n, proof)).toBe(
        false,
      );
    }
    expect(tree.proofOf(account(99))).toBeNull();
    expect(tree.amountOf(account(3))).toBe(3000n);
  });

  it("does not depend on the order payouts are given in", () => {
    expect(PayoutTree.build(ID, [...payouts].reverse()).root).toBe(
      PayoutTree.build(ID, payouts).root,
    );
  });

  it("binds leaves to the giveaway", () => {
    const other: Hex = `0x${"cd".repeat(32)}`;
    expect(PayoutTree.build(other, payouts).root).not.toBe(PayoutTree.build(ID, payouts).root);
  });

  it("round-trips through the published dump", () => {
    const tree = PayoutTree.build(ID, payouts);
    const dump = payoutTreeDumpSchema.parse(JSON.parse(JSON.stringify(tree.dump())));
    const loaded = PayoutTree.load(dump);
    expect(loaded.root).toBe(tree.root);
    expect(loaded.giveawayId).toBe(ID);
    expect(loaded.proofOf(account(5))).toEqual(tree.proofOf(account(5)));
  });

  it("rejects a tampered dump", () => {
    const dump = PayoutTree.build(ID, payouts).dump();
    dump.values[0]!.value[2] = "1";
    expect(() => PayoutTree.load(dump)).toThrow();
  });

  it("needs at least one payout and each account once", () => {
    expect(() => PayoutTree.build(ID, [])).toThrow(SettlementError);
    expect(() => PayoutTree.build(ID, [payouts[0]!, payouts[0]!])).toThrow(/once/);
  });
});
