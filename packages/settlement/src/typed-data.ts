import type { Address, Hex } from "@fairdrops/shared";
import { encodeAbiParameters, hashTypedData, keccak256, recoverTypedDataAddress } from "viem";

/** What verifiers sign: the contract's `Settlement` struct, bound to one giveaway. */
export interface SettlementMessage {
  giveawayId: Hex;
  payoutRoot: Hex;
  totalPayout: bigint;
  winnerCount: number;
  seed: Hex;
  transcriptHash: Hex;
}

/** Must match `SETTLEMENT_TYPEHASH` and the `EIP712("FairDrops", VERSION)` domain. */
export const SETTLEMENT_TYPES = {
  Settlement: [
    { name: "giveawayId", type: "bytes32" },
    { name: "payoutRoot", type: "bytes32" },
    { name: "totalPayout", type: "uint256" },
    { name: "winnerCount", type: "uint32" },
    { name: "seed", type: "bytes32" },
    { name: "transcriptHash", type: "bytes32" },
  ],
} as const;

export function settlementDomain(chainId: number, contract: Address) {
  return { name: "FairDrops", version: "1", chainId, verifyingContract: contract } as const;
}

/** Typed data for `signTypedData`; the domain binds the chain and the contract address. */
export function settlementTypedData(
  chainId: number,
  contract: Address,
  message: SettlementMessage,
) {
  return {
    domain: settlementDomain(chainId, contract),
    types: SETTLEMENT_TYPES,
    primaryType: "Settlement" as const,
    message,
  };
}

/** Equals the contract's `settlementDigest(id, settlement)`. */
export function settlementDigest(
  chainId: number,
  contract: Address,
  message: SettlementMessage,
): Hex {
  return hashTypedData(settlementTypedData(chainId, contract, message));
}

export async function recoverSettlementSigner(
  chainId: number,
  contract: Address,
  message: SettlementMessage,
  signature: Hex,
): Promise<Address> {
  const signer = await recoverTypedDataAddress({
    ...settlementTypedData(chainId, contract, message),
    signature,
  });
  return signer.toLowerCase() as Address;
}

/**
 * Orders signatures by ascending signer address, as `finalize` requires (it rejects duplicates
 * that way). Throws if two signatures come from the same signer.
 */
export async function sortSettlementSignatures(
  chainId: number,
  contract: Address,
  message: SettlementMessage,
  signatures: readonly Hex[],
): Promise<{ signer: Address; signature: Hex }[]> {
  const signed = await Promise.all(
    signatures.map(async (signature) => ({
      signer: await recoverSettlementSigner(chainId, contract, message, signature),
      signature,
    })),
  );
  signed.sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
  for (let i = 1; i < signed.length; i++) {
    if (signed[i]!.signer === signed[i - 1]!.signer) {
      throw new Error(`Two signatures from ${signed[i]!.signer}`);
    }
  }
  return signed;
}

/** The value `commitSeed` takes and `finalize` checks: keccak256(abi.encode(giveawayId, seed)). */
export function seedCommitment(giveawayId: Hex, seed: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [giveawayId, seed]),
  );
}
