import type { Hex } from "@fairdrops/shared";

/** Shared by server and client code, so it must not live in a "use client" module. */
export function isGiveawayId(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
