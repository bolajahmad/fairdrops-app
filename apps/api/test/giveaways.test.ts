import { PayoutTree, verifyPayoutProof } from "@fairdrops/settlement";
import {
  claimViewSchema,
  errorResponseSchema,
  giveawayEventViewSchema,
  giveawayViewSchema,
  pageSchema,
  payoutTreeDumpSchema,
  sessionViewSchema,
  settlementViewSchema,
  type Address,
  type Hex,
} from "@fairdrops/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestApp, newAccount, signIn, type TestApp } from "./harness.js";
import { CHAIN_ID } from "./session-fixtures.js";
import { CONTRACT, VERIFIER, createSettledGiveaway } from "./settlement-fixtures.js";

let t: TestApp;
const ALICE = "0x00000000000000000000000000000000000000a1" as Address;
const BOB = "0x00000000000000000000000000000000000000b2" as Address;
const CAROL = "0x00000000000000000000000000000000000000c3" as Address;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.reset();
});

const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;
const giveawayPage = pageSchema(giveawayViewSchema);

describe("giveaways", () => {
  it("serves an indexed giveaway with its metadata, reward policy and phase", async () => {
    const { giveawayId, sessionId } = await createSettledGiveaway(t.db, { players: [ALICE, BOB] });
    const body = giveawayViewSchema.parse(
      (await request(t.server).get(`/giveaways/${CHAIN_ID}/${giveawayId}`).expect(200)).body,
    );
    expect(body).toMatchObject({
      chainId: CHAIN_ID,
      giveawayId,
      contract: CONTRACT,
      prize: "1000000",
      tokenInfo: { symbol: "ETH", native: true },
      rewards: { kind: "weighted", bps: [7000, 3000], minScore: 1 },
      status: "ACTIVE",
      phase: "settling",
      session: { id: sessionId, status: "SETTLING" },
    });
    expect(body.metadata?.title).toBe("Dice night");

    await request(t.server)
      .get(`/giveaways/${CHAIN_ID}/0x${"f".repeat(64)}`)
      .expect(404);
  });

  it("lists newest first across pages, and filters", async () => {
    for (let i = 0; i < 5; i++) {
      await createSettledGiveaway(t.db, {
        players: [ALICE],
        createdAt: new Date(Date.UTC(2026, 8, 1 + i)),
      });
    }
    const first = giveawayPage.parse(
      (await request(t.server).get("/giveaways?limit=3").expect(200)).body,
    );
    expect(first.items).toHaveLength(3);
    const second = giveawayPage.parse(
      (await request(t.server).get(`/giveaways?limit=3&cursor=${first.nextCursor}`).expect(200))
        .body,
    );
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const dates = [...first.items, ...second.items].map((g) => g.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());

    const none = giveawayPage.parse(
      (await request(t.server).get("/giveaways?status=CANCELLED").expect(200)).body,
    );
    expect(none.items).toEqual([]);
    const bad = await request(t.server).get("/giveaways?cursor=nonsense").expect(400);
    expect(errorCode(bad.body)).toBe("VALIDATION_FAILED");
  });

  it("serves the on-chain activity log", async () => {
    const { giveawayId } = await createSettledGiveaway(t.db, { players: [ALICE] });
    await t.db.giveawayEvent.create({
      data: {
        chainId: CHAIN_ID,
        blockNumber: 10n,
        logIndex: 2,
        giveawayId,
        kind: "CREATED",
        blockHash: `0x${"1".repeat(64)}`,
        transactionHash: `0x${"2".repeat(64)}`,
        timestamp: new Date(),
        account: ALICE,
        amount: "1000000",
        fee: "10000",
      },
    });
    const page = pageSchema(giveawayEventViewSchema).parse(
      (await request(t.server).get(`/giveaways/${CHAIN_ID}/${giveawayId}/events`).expect(200)).body,
    );
    expect(page.items).toMatchObject([{ kind: "CREATED", blockNumber: "10", amount: "1000000" }]);
  });
});

describe("settlements", () => {
  it("publishes the payouts, the signatures and a payout tree that matches the root", async () => {
    const { sessionId, computed } = await createSettledGiveaway(t.db, {
      players: [ALICE, BOB, CAROL],
    });
    const settlement = settlementViewSchema.parse(
      (await request(t.server).get(`/sessions/${sessionId}/settlement`).expect(200)).body,
    );
    expect(settlement).toMatchObject({
      status: "PROPOSED",
      payoutRoot: computed.payoutRoot,
      totalPayout: computed.totalPayout.toString(),
      winnerCount: 2,
      signatures: [{ verifier: VERIFIER.address.toLowerCase() }],
      finalizeTx: null,
    });
    expect(settlement.payouts.map((p) => p.rank)).toEqual([1, 2]);

    const dump = payoutTreeDumpSchema.parse(
      (await request(t.server).get(`/sessions/${sessionId}/payout-tree`).expect(200)).body,
    );
    expect(PayoutTree.load(dump).root).toBe(computed.payoutRoot);
  });

  it("reveals a finished game's result even when its settlement failed", async () => {
    const { sessionId, seed } = await createSettledGiveaway(t.db, { players: [ALICE] });
    await t.db.gameSession.update({
      where: { id: sessionId },
      data: { status: "FAILED", failureReason: "test" },
    });
    const view = sessionViewSchema.parse(
      (await request(t.server).get(`/sessions/${sessionId}`).expect(200)).body,
    );
    expect(view.seed).toBe(seed);
  });

  it("answers 409 before a session has a settlement", async () => {
    const { sessionId } = await createSettledGiveaway(t.db, { players: [ALICE] });
    await t.db.settlement.delete({ where: { sessionId } });
    const response = await request(t.server).get(`/sessions/${sessionId}/settlement`).expect(409);
    expect(errorCode(response.body)).toBe("CONFLICT");
  });
});

describe("claims", () => {
  it("gives each winner the proof to claim, once the result is on-chain", async () => {
    const { giveawayId, computed } = await createSettledGiveaway(t.db, {
      players: [ALICE, BOB],
      status: "CONFIRMED",
    });
    for (const payout of computed.payouts) {
      const claim = claimViewSchema.parse(
        (
          await request(t.server)
            .get(`/claims/${CHAIN_ID}/${giveawayId}/${payout.account}`)
            .expect(200)
        ).body,
      );
      expect(claim).toMatchObject({
        amount: payout.amount.toString(),
        recipient: payout.account,
        claimable: true,
        claimedAt: null,
      });
      expect(
        verifyPayoutProof(
          computed.payoutRoot,
          giveawayId,
          claim.account,
          BigInt(claim.amount),
          claim.proof,
        ),
      ).toBe(true);
    }
    const loser = await request(t.server)
      .get(`/claims/${CHAIN_ID}/${giveawayId}/${CAROL}`)
      .expect(404);
    expect(errorCode(loser.body)).toBe("NOT_FOUND");
  });

  it("is not claimable until the result is on-chain, and follows payout wallets", async () => {
    const { giveawayId, computed } = await createSettledGiveaway(t.db, { players: [ALICE] });
    const winner = computed.payouts[0]!.account;
    await t.db.payoutWallet.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: CONTRACT,
        account: winner,
        wallet: CAROL,
        updatedBlock: 1n,
        updatedAt: new Date(),
      },
    });
    const claim = claimViewSchema.parse(
      (await request(t.server).get(`/claims/${CHAIN_ID}/${giveawayId}/${winner}`).expect(200)).body,
    );
    expect(claim).toMatchObject({ claimable: false, recipient: CAROL });
  });

  it("lists the signed-in user's prizes across their wallets", async () => {
    const player = await signIn(t.server, newAccount());
    const wallet = player.account.address.toLowerCase() as Hex;
    await createSettledGiveaway(t.db, { players: [wallet], status: "CONFIRMED" });
    await createSettledGiveaway(t.db, { players: [ALICE] });

    const mine = z
      .array(claimViewSchema)
      .parse(
        (await request(t.server).get("/me/claims").set("authorization", player.bearer).expect(200))
          .body,
      );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ account: wallet, claimable: true });
    await request(t.server).get("/me/claims").expect(401);
  });
});
