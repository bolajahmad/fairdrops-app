import { readFileSync } from "node:fs";
import { contractLimits } from "@fairdrops/shared";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/FairDrops.sol", import.meta.url), "utf8");

const UNITS: Record<string, number> = { minutes: 60, hours: 3600, days: 86_400 };

/** Reads `<type> public constant NAME = <number> [unit];` from the contract source. */
function constant(name: string): number {
  const match = new RegExp(`constant ${name} = ([0-9_]+)(?: (minutes|hours|days))?;`).exec(source);
  if (!match?.[1]) throw new Error(`Constant ${name} not found in FairDrops.sol`);
  return Number(match[1].replaceAll("_", "")) * (match[2] ? (UNITS[match[2]] ?? 1) : 1);
}

describe("contractLimits in @fairdrops/shared", () => {
  it.each([
    ["maxFeeBps", "MAX_FEE_BPS"],
    ["maxWinners", "MAX_WINNERS"],
    ["maxMetadataBytes", "MAX_METADATA_BYTES"],
    ["minStartDelaySeconds", "MIN_START_DELAY"],
    ["maxStartDelaySeconds", "MAX_START_DELAY"],
    ["minGameWindowSeconds", "MIN_GAME_WINDOW"],
    ["maxGameWindowSeconds", "MAX_GAME_WINDOW"],
    ["minClaimWindowSeconds", "MIN_CLAIM_WINDOW"],
    ["maxClaimWindowSeconds", "MAX_CLAIM_WINDOW"],
  ] as const)("%s matches %s", (key, solidityName) => {
    expect(contractLimits[key]).toBe(constant(solidityName));
  });
});
