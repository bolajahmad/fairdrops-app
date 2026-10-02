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

/**
 * How far FairDrops vouches for a token. `verified`: on FairDrops' own list. `listed`: on a public
 * token list FairDrops imports, not reviewed. `unverified`: any other ERC-20, read from the chain.
 * Any of them can be used for a giveaway; the level is shown to hosts and players alike.
 */
export const tokenTrustSchema = z.enum(["verified", "listed", "unverified"]);
export type TokenTrust = z.infer<typeof tokenTrustSchema>;

/**
 * A token as the API presents it: always with its chain, symbol, name and decimals, so an
 * amount is never shown without them. Tokens that are not verified always carry a warning.
 */
export const tokenViewSchema = tokenSchema.extend({
  native: z.boolean(),
  /** Same as `trust === "verified"`, kept for older clients. */
  approved: z.boolean(),
  trust: tokenTrustSchema,
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
  // Added 2026-10-01; symbol, name and decimals read from each contract on that day.
  {
    chainId: 11155111,
    address: "0xa801da100bf16d07f668f4a49e1f71fc54d05177",
    symbol: "USD.h",
    name: "Hyper USD",
    decimals: 18,
  },
  {
    chainId: 11155111,
    address: "0xd077a400968890eacc75cdc901f0356c943e4fdb",
    symbol: "USD₮",
    name: "Tether USD",
    decimals: 6,
  },
  {
    chainId: 84532,
    address: "0x52b6df3c98225f040b9b89a07180e7bc6ba34f87",
    symbol: "MNEE",
    name: "Mock MNEE",
    decimals: 18,
  },
  {
    chainId: 84532,
    address: "0xa801da100bf16d07f668f4a49e1f71fc54d05177",
    symbol: "USD.h",
    name: "Hyper USD",
    decimals: 18,
  },
];

export function findApprovedToken(chainId: number, address: string): Token | undefined {
  const normalized = address.toLowerCase();
  return approvedTokens.find((t) => t.chainId === chainId && t.address === normalized);
}

export const LISTED_TOKEN_WARNING =
  "This token is on a public token list but FairDrops has not reviewed it. Check the contract " +
  "address before hosting or playing for it.";

/**
 * The verified token this one imitates, if any: same chain, same symbol, different address.
 * Anyone can deploy a token called "USDC", so a lookalike gets a specific, louder warning.
 */
export function lookalikeOf(token: Token): Token | undefined {
  const symbol = token.symbol.trim().toLowerCase();
  const address = token.address.toLowerCase();
  return approvedTokens.find(
    (known) =>
      known.chainId === token.chainId &&
      known.symbol.toLowerCase() === symbol &&
      known.address !== address,
  );
}

export function toTokenView(token: Token, listed = false): TokenView {
  const address = token.address.toLowerCase() as Address;
  const approved = findApprovedToken(token.chainId, address) !== undefined;
  const trust: TokenTrust = approved ? "verified" : listed ? "listed" : "unverified";
  const lookalike = approved ? undefined : lookalikeOf(token);
  return {
    ...token,
    address,
    native: address === NATIVE_TOKEN_ADDRESS,
    approved,
    trust,
    warning: lookalike
      ? `This is not the ${lookalike.symbol} FairDrops lists. The listed one is ${lookalike.address}. Anyone can name a token ${lookalike.symbol}, so check the address.`
      : trust === "verified"
        ? null
        : trust === "listed"
          ? LISTED_TOKEN_WARNING
          : UNAPPROVED_TOKEN_WARNING,
  };
}

/** `GET /tokens`: search by symbol, name or address, optionally on one chain. */
export const tokenSearchQuerySchema = z.object({
  chainId: chainIdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TokenSearchQuery = z.infer<typeof tokenSearchQuerySchema>;
export type TokenSearchQueryInput = z.input<typeof tokenSearchQuerySchema>;
