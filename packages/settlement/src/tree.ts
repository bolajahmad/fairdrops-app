import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Address, Hex, PayoutTreeDump } from "@fairdrops/shared";
import { SettlementError, type Payout } from "./payouts.js";

/**
 * Leaf encoding of the payout tree. The contract's `payoutLeaf(id, account, amount)` is
 * `keccak256(keccak256(abi.encode(id, account, amount)))`, which is exactly how OpenZeppelin's
 * StandardMerkleTree hashes a leaf with this encoding.
 */
export const PAYOUT_LEAF_ENCODING = ["bytes32", "address", "uint256"] as const;

type Leaf = [Hex, Address, string];

/** The Merkle tree of a giveaway's payouts, and the proof each winner claims with. */
export class PayoutTree {
  private readonly indexByAccount = new Map<string, number>();

  private constructor(
    readonly giveawayId: Hex,
    private readonly tree: StandardMerkleTree<Leaf>,
  ) {
    for (const [index, [, account]] of tree.entries()) {
      this.indexByAccount.set(account.toLowerCase(), index);
    }
  }

  static build(giveawayId: Hex, payouts: readonly Payout[]): PayoutTree {
    if (payouts.length === 0) throw new SettlementError("A payout tree needs at least one payout");
    const id = giveawayId.toLowerCase() as Hex;
    const leaves = payouts.map((payout): Leaf => [
      id,
      payout.account.toLowerCase() as Address,
      payout.amount.toString(),
    ]);
    if (new Set(leaves.map(([, account]) => account)).size !== leaves.length) {
      throw new SettlementError("Each account can appear in the payout tree once");
    }
    return new PayoutTree(id, StandardMerkleTree.of(leaves, [...PAYOUT_LEAF_ENCODING]));
  }

  /** Loads a published dump. Throws if it is not internally consistent. */
  static load(dump: PayoutTreeDump): PayoutTree {
    const tree = StandardMerkleTree.load<Leaf>({
      format: dump.format,
      leafEncoding: [...dump.leafEncoding],
      tree: dump.tree,
      values: dump.values.map((entry) => ({
        value: entry.value,
        treeIndex: entry.treeIndex,
      })),
    });
    tree.validate();
    const ids = new Set(dump.values.map((entry) => entry.value[0].toLowerCase()));
    if (ids.size !== 1) throw new SettlementError("A payout tree covers exactly one giveaway");
    return new PayoutTree([...ids][0] as Hex, tree);
  }

  get root(): Hex {
    return this.tree.root as Hex;
  }

  get size(): number {
    return this.tree.length;
  }

  /** Every payout in the tree, in leaf order. */
  payouts(): { account: Address; amount: bigint }[] {
    return [...this.tree.entries()].map(([, [, account, amount]]) => ({
      account: account.toLowerCase() as Address,
      amount: BigInt(amount),
    }));
  }

  amountOf(account: Address): bigint | null {
    const index = this.indexByAccount.get(account.toLowerCase());
    if (index === undefined) return null;
    return BigInt(this.tree.at(index)![2]);
  }

  /** The proof `claim(id, account, amount, proof)` takes, or null if the account won nothing. */
  proofOf(account: Address): Hex[] | null {
    const index = this.indexByAccount.get(account.toLowerCase());
    if (index === undefined) return null;
    return this.tree.getProof(index) as Hex[];
  }

  dump(): PayoutTreeDump {
    const data = this.tree.dump();
    return {
      format: "standard-v1",
      leafEncoding: [...PAYOUT_LEAF_ENCODING],
      tree: data.tree.map((node) => node.toLowerCase() as Hex),
      values: data.values.map((entry) => ({
        value: [
          entry.value[0].toLowerCase() as Hex,
          entry.value[1].toLowerCase() as Address,
          entry.value[2],
        ],
        treeIndex: entry.treeIndex,
      })),
    };
  }
}

/** Checks a proof the way the contract does, without the tree. */
export function verifyPayoutProof(
  root: Hex,
  giveawayId: Hex,
  account: Address,
  amount: bigint,
  proof: readonly Hex[],
): boolean {
  return StandardMerkleTree.verify(
    root,
    [...PAYOUT_LEAF_ENCODING],
    [giveawayId, account, amount.toString()],
    [...proof],
  );
}
