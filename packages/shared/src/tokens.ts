import { z } from "zod";
import { chains, type Chain } from "./chains.js";
import { addressSchema, chainIdSchema, type Address } from "./primitives.js";

/** FairDrops represents the chain's native currency with the zero address. */
export const NATIVE_TOKEN_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export const UNAPPROVED_TOKEN_WARNING =
  "This token is not on the FairDrops approved list. Anyone can create a token with any name " +
  "or symbol, so check the contract address before hosting or playing for it.";

export const tokenSchema = z.object({
  chainId: chainIdSchema,
  address: addressSchema,
  symbol: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  decimals: z.number().int().min(0).max(36),
});
export type Token = z.infer<typeof tokenSchema>;

/** A token as the API presents it. Unapproved tokens always carry a warning. */
export const tokenViewSchema = tokenSchema.extend({
  native: z.boolean(),
  approved: z.boolean(),
  warning: z.string().nullable(),
});
export type TokenView = z.infer<typeof tokenViewSchema>;

function nativeToken(chain: Chain): Token {
  return {
    chainId: chain.chainId,
    address: NATIVE_TOKEN_ADDRESS,
    symbol: chain.nativeCurrency.symbol,
    name: chain.nativeCurrency.name,
    decimals: chain.nativeCurrency.decimals,
  };
}

/**
 * Tokens FairDrops vouches for. Each ERC-20 entry was checked on-chain (symbol, name, decimals)
 * before being added. Any other ERC-20 can still be used for a giveaway, with a warning.
 */
export const approvedTokens: readonly Token[] = [
  ...chains.map(nativeToken),
  {
    chainId: 11155111,
    address: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    symbol: "USDC",
    name: "USDC",
    decimals: 6,
  },
  {
    chainId: 84532,
    address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    symbol: "USDC",
    name: "USDC",
    decimals: 6,
  },
];

export function findApprovedToken(chainId: number, address: string): Token | undefined {
  const normalized = address.toLowerCase();
  return approvedTokens.find((t) => t.chainId === chainId && t.address === normalized);
}

export function toTokenView(token: Token): TokenView {
  const approved = findApprovedToken(token.chainId, token.address) !== undefined;
  return {
    ...token,
    native: token.address === NATIVE_TOKEN_ADDRESS,
    approved,
    warning: approved ? null : UNAPPROVED_TOKEN_WARNING,
  };
}
