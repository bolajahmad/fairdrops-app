/**
 * Limits enforced by the FairDrops contract, mirrored so clients can validate before sending a
 * transaction. `packages/contracts/test/limits.test.ts` fails if these drift from the Solidity
 * constants.
 */
export const contractLimits = {
  maxFeeBps: 500,
  maxWinners: 100_000,
  maxMetadataBytes: 4096,
  minStartDelaySeconds: 2 * 60,
  maxStartDelaySeconds: 180 * 24 * 60 * 60,
  minGameWindowSeconds: 10 * 60,
  maxGameWindowSeconds: 30 * 24 * 60 * 60,
  minClaimWindowSeconds: 7 * 24 * 60 * 60,
  maxClaimWindowSeconds: 365 * 24 * 60 * 60,
} as const;
