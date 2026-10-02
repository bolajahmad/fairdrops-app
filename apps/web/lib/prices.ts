"use client";

import { PRICE_CURRENCY } from "@fairdrops/shared";
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
