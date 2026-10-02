import { z } from "zod";
import { findChain } from "./chains.js";
import { NATIVE_TOKEN_ADDRESS, findApprovedToken } from "./tokens.js";

/**
 * Approximate values are quoted in USDT, treated as one US dollar. They are for orientation
 * only (a dashboard total, a summary); prizes are always locked, paid and verified in the
 * giveaway's own token.
 */
export const PRICE_CURRENCY = "USDT";

/** Price id of a token pegged to the US dollar: always worth 1 USDT, never fetched. */
export const USD_PEG = "usd";

/**
 * What a native currency is priced as, by symbol. Testnet coins have no market of their own,
 * so they are priced as the mainnet coin they stand in for.
 */
const nativePriceIds: Record<string, string> = {
  ETH: "ethereum",
  MON: "monad",
  PAS: "polkadot",
};

/** Verified ERC-20s pegged to the dollar, keyed `${chainId}:${address}`. */
const dollarPegged = new Set([
  "11155111:0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", // USDC
  "84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e", // USDC
  "11155111:0xa801da100bf16d07f668f4a49e1f71fc54d05177", // USD.h
  "11155111:0xd077a400968890eacc75cdc901f0356c943e4fdb", // USD₮
  "84532:0x52b6df3c98225f040b9b89a07180e7bc6ba34f87", // MNEE
  "84532:0xa801da100bf16d07f668f4a49e1f71fc54d05177", // USD.h
]);

/**
 * The price feed id for a token, or null when FairDrops does not price it. Only verified tokens
 * are priced: anyone can deploy a token called "USDC", and pricing it at a dollar would show a
 * worthless prize as a real one.
 */
export function priceIdOf(token: { chainId: number; address: string }): string | null {
  const address = token.address.toLowerCase();
  if (!findApprovedToken(token.chainId, address)) return null;
  if (address === NATIVE_TOKEN_ADDRESS) {
    const symbol = findChain(token.chainId)?.nativeCurrency.symbol;
    return symbol ? (nativePriceIds[symbol] ?? null) : null;
  }
  return dollarPegged.has(`${token.chainId}:${address}`) ? USD_PEG : null;
}

/** Every price id a verified token can need, so a server can fetch them in one request. */
export function pricedIds(): string[] {
  return [...new Set(Object.values(nativePriceIds))];
}

/** `GET /prices`: USDT per one whole token, by price id. A missing id means no price right now. */
export const pricesResponseSchema = z.object({
  currency: z.literal(PRICE_CURRENCY),
  prices: z.record(z.string(), z.number().nonnegative()),
  /** When the market prices were fetched; null when only the dollar peg is known. */
  updatedAt: z.iso.datetime().nullable(),
});
export type PricesResponse = z.infer<typeof pricesResponseSchema>;

/**
 * The approximate USDT value of `amount` (in the token's smallest unit), or null when the token
 * has no price. Precise enough for display, not for accounting.
 */
export function referenceValue(
  token: { chainId: number; address: string },
  amount: bigint | string,
  decimals: number,
  prices: Record<string, number>,
): number | null {
  const id = priceIdOf(token);
  if (id === null) return null;
  const price = id === USD_PEG ? 1 : prices[id];
  if (price === undefined) return null;
  const units = BigInt(amount);
  const scale = 10n ** BigInt(decimals);
  const whole = Number(units / scale) + Number(units % scale) / Number(scale);
  return whole * price;
}
