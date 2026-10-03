import type { Address, Hex } from "@fairdrops/shared";
import { hashTypedData } from "viem";
import { settlementDomain } from "./typed-data.js";

/**
 * Actions someone signs and a relayer submits, so they pay no gas. Each must match the
 * contract's `*_TYPEHASH` exactly; the settlement parity fixture checks that on both sides.
 * `nonce` is the signer's next `nonces(account)`, and `deadline` is in unix seconds.
 */
export const RELAY_TYPES = {
  ClaimTo: [
    { name: "giveawayId", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "fee", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  WithdrawTo: [
    { name: "giveawayId", type: "bytes32" },
    { name: "host", type: "address" },
    { name: "recipient", type: "address" },
    { name: "fee", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  SetPayoutWallet: [
    { name: "account", type: "address" },
    { name: "wallet", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  CreateGiveaway: [
    { name: "host", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "startTime", type: "uint64" },
    { name: "finalizeDeadline", type: "uint64" },
    { name: "maxWinners", type: "uint32" },
    { name: "metadataHash", type: "bytes32" },
    { name: "relayFee", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type RelayAction = keyof typeof RELAY_TYPES;

/** Collect a prize to `recipient`; the relayer keeps `fee` of it. */
export interface ClaimToMessage {
  giveawayId: Hex;
  account: Address;
  amount: bigint;
  recipient: Address;
  fee: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** Withdraw what a host is owed to `recipient`; the relayer keeps `fee` of it. */
export interface WithdrawToMessage {
  giveawayId: Hex;
  host: Address;
  recipient: Address;
  fee: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** Send everything owed to `account` to `wallet` from now on (zero clears it). */
export interface SetPayoutWalletMessage {
  account: Address;
  wallet: Address;
  nonce: bigint;
  deadline: bigint;
}

/** Open a giveaway for `host` with these terms; the relayer keeps `relayFee` of the deposit. */
export interface CreateGiveawayMessage {
  host: Address;
  token: Address;
  amount: bigint;
  startTime: bigint;
  finalizeDeadline: bigint;
  maxWinners: number;
  metadataHash: Hex;
  relayFee: bigint;
  nonce: bigint;
  deadline: bigint;
}

interface Messages {
  ClaimTo: ClaimToMessage;
  WithdrawTo: WithdrawToMessage;
  SetPayoutWallet: SetPayoutWalletMessage;
  CreateGiveaway: CreateGiveawayMessage;
}

/** Typed data for `signTypedData`, bound to one chain and one FairDrops contract. */
export function relayTypedData<A extends RelayAction>(
  chainId: number,
  contract: Address,
  primaryType: A,
  message: Messages[A],
) {
  return {
    domain: settlementDomain(chainId, contract),
    types: { [primaryType]: RELAY_TYPES[primaryType] } as Pick<typeof RELAY_TYPES, A>,
    primaryType,
    message,
  };
}

/** The digest the contract checks the signature against. */
export function relayDigest<A extends RelayAction>(
  chainId: number,
  contract: Address,
  primaryType: A,
  message: Messages[A],
): Hex {
  return hashTypedData(relayTypedData(chainId, contract, primaryType, message) as never);
}
