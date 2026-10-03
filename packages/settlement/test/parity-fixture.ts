/**
 * Builds the settlement parity fixture that Foundry checks against the contract: payout leaves,
 * the Merkle root and every proof, the EIP-712 settlement digest, and a signature over it. If
 * the TypeScript side and the contract ever disagree on any of these, a claim or a finalize would
 * revert on-chain; the fixture turns that into a failing test on both sides.
 *
 * `parity.test.ts` compares it with the committed file; `pnpm --filter @fairdrops/settlement
 * fixtures` rewrites the file.
 */
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "@fairdrops/shared";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PayoutTree, PAYOUT_LEAF_ENCODING } from "../src/tree.js";
import { relayDigest } from "../src/relay.js";
import {
  settlementDigest,
  settlementTypedData,
  type SettlementMessage,
} from "../src/typed-data.js";

export const FIXTURE_PATH = fileURLToPath(
  new URL("../../contracts/test/fixtures/settlement-parity.json", import.meta.url),
);

/** Only ever used for this fixture. */
const VERIFIER_KEY = keccak256(toHex("fairdrops settlement parity verifier"));

export interface ParityFixture {
  chainId: number;
  contract: Address;
  giveawayId: Hex;
  payouts: { account: Address; amount: string; leaf: Hex; proof: Hex[] }[];
  root: Hex;
  settlement: {
    payoutRoot: Hex;
    totalPayout: string;
    winnerCount: number;
    seed: Hex;
    transcriptHash: Hex;
  };
  digest: Hex;
  verifier: Address;
  signature: Hex;
  /** Sample signed actions and their EIP-712 digests, for the contract's `*_TYPEHASH`es. */
  relay: {
    claimTo: Record<string, string> & { digest: Hex };
    withdrawTo: Record<string, string> & { digest: Hex };
    setPayoutWallet: Record<string, string> & { digest: Hex };
    createGiveaway: Record<string, string> & { digest: Hex };
  };
}

/** Bigints as decimal strings, as the rest of the fixture stores amounts. */
function strings(message: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(message).map(([key, value]) => [key, String(value)]));
}

export async function buildParityFixture(): Promise<ParityFixture> {
  const chainId = 84532;
  const contract = "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72" as Address;
  const giveawayId = keccak256(toHex("parity giveaway"));
  // Five leaves, so the tree has an unpaired node, and one amount near the top of uint256.
  const payouts = [
    { account: "0x00000000000000000000000000000000000000a1", amount: 500_000n, rank: 1 },
    { account: "0x00000000000000000000000000000000000000b2", amount: 300_000n, rank: 2 },
    { account: "0x00000000000000000000000000000000000000c3", amount: 150_000n, rank: 3 },
    { account: "0xffffffffffffffffffffffffffffffffffffffff", amount: 1n, rank: 4 },
    {
      account: "0x1234567890abcdef1234567890abcdef12345678",
      amount: 2n ** 255n,
      rank: 5,
    },
  ] as { account: Address; amount: bigint; rank: number }[];

  const tree = PayoutTree.build(giveawayId, payouts);
  const message: SettlementMessage = {
    giveawayId,
    payoutRoot: tree.root,
    totalPayout: 950_001n,
    winnerCount: payouts.length,
    seed: keccak256(toHex("parity seed")),
    transcriptHash: keccak256(toHex("parity transcript")),
  };
  const verifier = privateKeyToAccount(VERIFIER_KEY);

  return {
    chainId,
    contract,
    giveawayId,
    payouts: payouts.map((payout) => ({
      account: payout.account,
      amount: payout.amount.toString(),
      leaf: StandardMerkleTree.of(
        [[giveawayId, payout.account, payout.amount.toString()]],
        [...PAYOUT_LEAF_ENCODING],
      ).root as Hex,
      proof: tree.proofOf(payout.account)!,
    })),
    root: tree.root,
    settlement: {
      payoutRoot: message.payoutRoot,
      totalPayout: message.totalPayout.toString(),
      winnerCount: message.winnerCount,
      seed: message.seed,
      transcriptHash: message.transcriptHash,
    },
    digest: settlementDigest(chainId, contract, message),
    verifier: verifier.address.toLowerCase() as Address,
    signature: await verifier.signTypedData(settlementTypedData(chainId, contract, message)),
    relay: relayFixture(chainId, contract, giveawayId),
  };
}

function relayFixture(chainId: number, contract: Address, giveawayId: Hex) {
  const account = "0x00000000000000000000000000000000000000a1" as Address;
  const recipient = "0x00000000000000000000000000000000000000d4" as Address;
  const claimTo = {
    giveawayId,
    account,
    amount: 500_000n,
    recipient,
    fee: 1_234n,
    nonce: 7n,
    deadline: 1_900_000_000n,
  };
  const withdrawTo = {
    giveawayId,
    host: account,
    recipient,
    fee: 99n,
    nonce: 3n,
    deadline: 1_900_000_000n,
  };
  const setPayoutWallet = { account, wallet: recipient, nonce: 0n, deadline: 1_900_000_000n };
  const createGiveaway = {
    host: account,
    token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Address,
    amount: 10_000_000n,
    startTime: 1_800_000_000n,
    finalizeDeadline: 1_800_086_400n,
    maxWinners: 5,
    metadataHash: keccak256(toHex("parity metadata")),
    relayFee: 25_000n,
    nonce: 1n,
    deadline: 1_900_000_000n,
  };
  return {
    claimTo: {
      ...strings(claimTo),
      digest: relayDigest(chainId, contract, "ClaimTo", claimTo),
    },
    withdrawTo: {
      ...strings(withdrawTo),
      digest: relayDigest(chainId, contract, "WithdrawTo", withdrawTo),
    },
    setPayoutWallet: {
      ...strings(setPayoutWallet),
      digest: relayDigest(chainId, contract, "SetPayoutWallet", setPayoutWallet),
    },
    createGiveaway: {
      ...strings(createGiveaway),
      digest: relayDigest(chainId, contract, "CreateGiveaway", createGiveaway),
    },
  };
}

export function serializeFixture(fixture: ParityFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
