"use client";

import { PRICE_CURRENCY, referenceValue } from "@fairdrops/shared";
import { useEffect, useState } from "react";
import { browserFairDrops } from "./fairdrops";

/**
 * Approximate USDT prices by price id, or null until loaded or when they can't be fetched; then
 * screens show token amounts only.
 */
export function usePrices(): Record<string, number> | null {
  const [prices, setPrices] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let live = true;
    browserFairDrops()
      .tokens.prices()
      .then((body) => live && setPrices(body.prices))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return prices;
}

/** "≈ 1,234.50 USDT"; tiny non-zero values read "< 0.01 USDT" rather than a misleading zero. */
export function formatReference(value: number, approximate = true): string {
  const prefix = approximate ? "≈ " : "";
  if (value > 0 && value < 0.01) return `< 0.01 ${PRICE_CURRENCY}`;
  const text = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: value >= 1000 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${prefix}${text} ${PRICE_CURRENCY}`;
}

/** One token's total, with its approximate USDT value (null when it has no price). */
export interface TokenTotal {
  key: string;
  chainId: number;
  symbol: string;
  decimals: number;
  amount: bigint;
  value: number | null;
}

/**
 * Adds amounts up per token (USDC on two networks is two tokens) and prices each total. Without
 * prices every value is null, and screens show token amounts only.
 */
export function totalsByToken(
  entries: readonly {
    chainId: number;
    address: string;
    amount: bigint | string;
    decimals: number;
    symbol: string;
  }[],
  prices: Record<string, number> | null,
): TokenTotal[] {
  const totals = new Map<string, TokenTotal>();
  for (const entry of entries) {
    const key = `${entry.chainId}:${entry.address.toLowerCase()}`;
    const total = totals.get(key) ?? {
      key,
      chainId: entry.chainId,
      symbol: entry.symbol,
      decimals: entry.decimals,
      amount: 0n,
      value: null,
    };
    total.amount += BigInt(entry.amount);
    totals.set(key, total);
  }
  for (const [key, total] of totals) {
    const [chainId, address] = key.split(":") as [string, string];
    total.value = prices
      ? referenceValue({ chainId: Number(chainId), address }, total.amount, total.decimals, prices)
      : null;
  }
  return [...totals.values()];
}
