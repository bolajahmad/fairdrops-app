import { describe, expect, it } from "vitest";
import { PayoutTree, verifyPayoutProof } from "../src/tree.js";
import { recoverSettlementSigner, settlementDigest } from "../src/typed-data.js";
import { FIXTURE_PATH, buildParityFixture, serializeFixture } from "./parity-fixture.js";

// packages/contracts/test/FairDrops.parity.t.sol checks the same file against the contract.
describe("settlement parity fixture", () => {
  it("is up to date (pnpm --filter @fairdrops/settlement fixtures rewrites it)", async () => {
    await expect(serializeFixture(await buildParityFixture())).toMatchFileSnapshot(FIXTURE_PATH);
  });

  it("is consistent with the TypeScript implementation", async () => {
    const fixture = await buildParityFixture();
    const tree = PayoutTree.build(
      fixture.giveawayId,
      fixture.payouts.map((p, i) => ({
        account: p.account,
        amount: BigInt(p.amount),
        rank: i + 1,
      })),
    );
    expect(tree.root).toBe(fixture.root);
    for (const payout of fixture.payouts) {
      expect(
        verifyPayoutProof(
          fixture.root,
          fixture.giveawayId,
          payout.account,
          BigInt(payout.amount),
          payout.proof,
        ),
      ).toBe(true);
    }

    const message = {
      ...fixture.settlement,
      giveawayId: fixture.giveawayId,
      totalPayout: BigInt(fixture.settlement.totalPayout),
    };
    expect(settlementDigest(fixture.chainId, fixture.contract, message)).toBe(fixture.digest);
    expect(
      await recoverSettlementSigner(fixture.chainId, fixture.contract, message, fixture.signature),
    ).toBe(fixture.verifier);
  });
});
