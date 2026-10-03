import { z } from "zod";
import { findChain } from "./chains.js";
import { priceIdOf, USD_PEG } from "./prices.js";
import {
  addressSchema,
  bytes32Schema,
  chainIdSchema,
  hexSchema,
  isoDateTimeSchema,
  uint256Schema,
  uuidSchema,
  type Address,
} from "./primitives.js";
import { NATIVE_TOKEN_ADDRESS } from "./tokens.js";

/**
 * Gas-free actions. Someone signs; FairDrops' relayer submits the transaction, pays the gas and
 * keeps a fee in the token being moved, which the signer agreed to in the signature.
 *
 * - `claim`: collect a prize to any wallet (FairDrops `claimWithSig`).
 * - `withdraw`: a host's refund or leftovers to any wallet (`withdrawWithSig`).
 * - `payoutWallet`: send everything owed to an account somewhere else (`setPayoutWalletWithSig`).
 * - `execute`: a batch an embedded wallet signs and runs through FairDropsAccount (EIP-7702):
 *   sending its funds, or hosting a giveaway from it.
 */
export const relayActionSchema = z.enum(["claim", "withdraw", "payoutWallet", "execute"]);
export type RelayAction = z.infer<typeof relayActionSchema>;

/**
 * What an `execute` batch is for: the relayer only submits these shapes. `send` moves funds out
 * of the wallet, `host` creates a giveaway, `manage` adds to or cancels one before it starts.
 */
export const executePurposeSchema = z.enum(["send", "host", "manage"]);
export type ExecutePurpose = z.infer<typeof executePurposeSchema>;

/** Gas each action uses, generously: fees are quoted from it. */
export const RELAY_GAS: Record<
  RelayAction | "executeHost" | "executeManage" | "delegation",
  bigint
> = {
  claim: 170_000n,
  withdraw: 140_000n,
  payoutWallet: 90_000n,
  execute: 150_000n,
  executeHost: 450_000n,
  executeManage: 250_000n,
  /** Extra for the first batch, which also delegates the wallet (EIP-7702). */
  delegation: 40_000n,
};

/** Gas for an embedded wallet's batch, including the delegation on its first one. */
export function executeGas(purpose: ExecutePurpose | undefined, delegated: boolean): bigint {
  const base =
    purpose === "host"
      ? RELAY_GAS.executeHost
      : purpose === "manage"
        ? RELAY_GAS.executeManage
        : RELAY_GAS.execute;
  return delegated ? base : base + RELAY_GAS.delegation;
}

/** Headroom over the gas cost, for price moves between the quote and the transaction. */
const MARGIN_BPS = 13_000n;
/** For tokens without a price, the fee is this share of the amount moved. */
const UNPRICED_FEE_BPS = 100n;
/** A fee never takes more than this share of the amount moved. */
const MAX_FEE_BPS = 1_000n;

/**
 * The relayer's fee for an action, in the token's smallest unit. The gas cost converted into the
 * token at today's prices, plus a margin; a share of the amount when the token has no price. It
 * never takes more than a tenth of `amount`, and an action worth less than its fee isn't offered.
 */
export function relayFee(input: {
  chainId: number;
  token: Address;
  decimals: number;
  /** What the action moves, in the token's smallest unit; caps the fee. */
  amount: bigint;
  gas: bigint;
  gasPriceWei: bigint;
  /** USD per whole token by price id, as `GET /prices` serves them. */
  prices: Record<string, number>;
}): bigint {
  const costWei = (input.gas * input.gasPriceWei * MARGIN_BPS) / 10_000n;
  const native = input.token.toLowerCase() === NATIVE_TOKEN_ADDRESS;
  let fee: bigint;
  if (native) {
    fee = costWei;
  } else {
    const nativeId = priceIdOf({ chainId: input.chainId, address: NATIVE_TOKEN_ADDRESS });
    const tokenId = priceIdOf({ chainId: input.chainId, address: input.token });
    const nativeUsd = nativeId ? input.prices[nativeId] : undefined;
    const tokenUsd = tokenId === USD_PEG ? 1 : tokenId ? input.prices[tokenId] : undefined;
    if (nativeUsd && tokenUsd) {
      // cost in USD = costWei / 1e18 * nativeUsd; in tokens = that / tokenUsd * 10^decimals.
      const scale = 1_000_000n;
      const ratio = BigInt(Math.ceil((nativeUsd / tokenUsd) * Number(scale)));
      fee = (costWei * ratio * 10n ** BigInt(input.decimals)) / (10n ** 18n * scale);
    } else {
      fee = (input.amount * UNPRICED_FEE_BPS) / 10_000n;
    }
  }
  const cap = (input.amount * MAX_FEE_BPS) / 10_000n;
  return fee > cap ? cap : fee < 1n ? 1n : fee;
}

/** The native coin's symbol, for "fee paid in ETH" when a batch moves the native coin. */
export function nativeSymbol(chainId: number): string {
  return findChain(chainId)?.nativeCurrency.symbol ?? "ETH";
}

// Quotes

export const relayQuoteQuerySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  action: relayActionSchema,
  purpose: executePurposeSchema.optional(),
  /** Who signs: their nonce is part of the quote. */
  account: addressSchema,
  /** The token the fee is paid in: the prize token, or what the wallet sends. */
  token: addressSchema,
  /** What the action moves, in the token's smallest unit. */
  amount: uint256Schema,
});
export type RelayQuoteQuery = z.infer<typeof relayQuoteQuerySchema>;
export type RelayQuoteQueryInput = z.input<typeof relayQuoteQuerySchema>;

/** Everything a client needs to sign: the fee, who receives it, the nonce and a deadline. */
export const relayQuoteSchema = z.object({
  chainId: z.number().int().positive(),
  action: relayActionSchema,
  token: addressSchema,
  fee: uint256Schema,
  /** The relayer's address: an `execute` batch pays the fee to it. */
  relayer: addressSchema,
  /** FairDrops on this chain, the contract `claim`, `withdraw` and `payoutWallet` sign for. */
  contract: addressSchema,
  /** The nonce to sign with: FairDrops' `nonces(account)`, or the wallet's own for `execute`. */
  nonce: uint256Schema,
  /** Unix seconds; the signature is void after it. */
  deadline: z.number().int().positive(),
  /** For `execute`: the delegate the wallet must point to (EIP-7702), and whether it already does. */
  delegate: addressSchema.nullable(),
  delegated: z.boolean().nullable(),
  /** For `execute` on a wallet not yet delegated: its transaction count, for the authorization. */
  authorizationNonce: z.number().int().nonnegative().nullable(),
});
export type RelayQuote = z.infer<typeof relayQuoteSchema>;

// Submissions

const signed = {
  chainId: chainIdSchema,
  nonce: uint256Schema,
  deadline: z.number().int().positive(),
  signature: hexSchema,
};

export const accountCallSchema = z.object({
  to: addressSchema,
  value: uint256Schema,
  data: hexSchema,
});
export type AccountCallView = z.infer<typeof accountCallSchema>;

/** A signed EIP-7702 authorization pointing the wallet at FairDropsAccount. */
export const authorizationSchema = z.object({
  address: addressSchema,
  chainId: z.number().int().nonnegative(),
  nonce: z.number().int().nonnegative(),
  r: hexSchema,
  s: hexSchema,
  yParity: z.number().int().min(0).max(1),
});
export type SignedAuthorization = z.infer<typeof authorizationSchema>;

export const relayRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("claim"),
    ...signed,
    giveawayId: bytes32Schema,
    account: addressSchema,
    amount: uint256Schema,
    recipient: addressSchema,
    fee: uint256Schema,
  }),
  z.object({
    action: z.literal("withdraw"),
    ...signed,
    giveawayId: bytes32Schema,
    host: addressSchema,
    recipient: addressSchema,
    fee: uint256Schema,
  }),
  z.object({
    action: z.literal("payoutWallet"),
    ...signed,
    account: addressSchema,
    wallet: addressSchema,
  }),
  z.object({
    action: z.literal("execute"),
    ...signed,
    purpose: executePurposeSchema,
    account: addressSchema,
    calls: z.array(accountCallSchema).min(1).max(4),
    /** Required the first time, while the wallet isn't delegated yet. */
    authorization: authorizationSchema.optional(),
  }),
]);
export type RelayRequest = z.infer<typeof relayRequestSchema>;
export type RelayRequestInput = z.input<typeof relayRequestSchema>;

export const relayStatusSchema = z.enum(["QUEUED", "SENT", "MINED", "FAILED"]);
export type RelayStatus = z.infer<typeof relayStatusSchema>;

export const relayViewSchema = z.object({
  id: uuidSchema,
  chainId: z.number().int().positive(),
  action: relayActionSchema,
  account: addressSchema,
  status: relayStatusSchema,
  fee: uint256Schema,
  feeToken: addressSchema,
  txHash: bytes32Schema.nullable(),
  error: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type RelayView = z.infer<typeof relayViewSchema>;
