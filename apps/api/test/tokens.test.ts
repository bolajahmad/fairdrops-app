import {
  claimViewSchema,
  errorResponseSchema,
  giveawayViewSchema,
  pageSchema,
  leaderboardsViewSchema,
  pricesResponseSchema,
  tokenViewSchema,
  type Address,
} from "@fairdrops/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness.js";
import { CHAIN_ID } from "./session-fixtures.js";
import { createSettledGiveaway } from "./settlement-fixtures.js";

let t: TestApp;
const tokenList = tokenViewSchema.array();
const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

const HUSDC = "0x00000000000000000000000000000000000000d6" as Address;
const FAKE_USDC = "0x00000000000000000000000000000000000000fa" as Address;
const NOT_A_TOKEN = "0x00000000000000000000000000000000000000ee" as Address;
const BASE_SEPOLIA_USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  t.erc20s.set(`${CHAIN_ID}:${HUSDC}`, { symbol: "HUSDC", name: "Hello USD", decimals: 6 });
  t.erc20s.set(`${CHAIN_ID}:${FAKE_USDC}`, { symbol: "USDC", name: "Totally USDC", decimals: 18 });
});

describe("tokens", () => {
  it("serves FairDrops' own tokens as verified without reading the chain", async () => {
    const body = tokenViewSchema.parse(
      (await request(t.server).get(`/tokens/${CHAIN_ID}/${BASE_SEPOLIA_USDC}`).expect(200)).body,
    );
    expect(body).toMatchObject({ symbol: "USDC", decimals: 6, trust: "verified", warning: null });
    expect(t.tokenReads.count).toBe(0);
  });

  it("reads any other ERC-20 from its contract once, then serves it from the table", async () => {
    for (let i = 0; i < 3; i++) {
      const body = tokenViewSchema.parse(
        (await request(t.server).get(`/tokens/${CHAIN_ID}/${HUSDC}`).expect(200)).body,
      );
      expect(body).toMatchObject({
        chainId: CHAIN_ID,
        address: HUSDC,
        symbol: "HUSDC",
        name: "Hello USD",
        decimals: 6,
        trust: "unverified",
        approved: false,
      });
      expect(body.warning).toBeTruthy();
    }
    expect(t.tokenReads.count).toBe(1);
    expect(await t.db.token.count()).toBe(1);
  });

  it("refuses an address that isn't an ERC-20, and remembers nothing", async () => {
    const response = await request(t.server).get(`/tokens/${CHAIN_ID}/${NOT_A_TOKEN}`).expect(404);
    expect(errorCode(response.body)).toBe("NOT_FOUND");
    expect(await t.db.token.count()).toBe(0);
  });

  it("warns specifically about a token imitating a listed one", async () => {
    const body = tokenViewSchema.parse(
      (await request(t.server).get(`/tokens/${CHAIN_ID}/${FAKE_USDC}`).expect(200)).body,
    );
    expect(body.trust).toBe("unverified");
    expect(body.warning).toContain(BASE_SEPOLIA_USDC);
  });

  it("searches by symbol, verified tokens first, on hostable chains only", async () => {
    await request(t.server).get(`/tokens/${CHAIN_ID}/${FAKE_USDC}`).expect(200);
    const results = tokenList.parse(
      (await request(t.server).get("/tokens").query({ q: "usdc" }).expect(200)).body,
    );
    expect(results[0]).toMatchObject({ symbol: "USDC", trust: "verified" });
    expect(results.some((token) => token.address === FAKE_USDC)).toBe(true);
    // Polkadot Hub has a deployment but no indexer: its tokens are not offered.
    expect(results.every((token) => token.chainId !== 420420417)).toBe(true);
  });

  it("finds a pasted address on whichever hostable chain has it", async () => {
    const results = tokenList.parse(
      (
        await request(t.server)
          .get("/tokens")
          .query({ q: HUSDC.toUpperCase().replace("0X", "0x") })
          .expect(200)
      ).body,
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ chainId: CHAIN_ID, symbol: "HUSDC", decimals: 6 });
  });

  it("gives giveaway and claim views the real symbol and decimals of any token", async () => {
    const { giveawayId } = await createSettledGiveaway(t.db, {
      players: ["0x00000000000000000000000000000000000000a1"],
      status: "CONFIRMED",
      token: HUSDC,
    });
    const one = giveawayViewSchema.parse(
      (await request(t.server).get(`/giveaways/${CHAIN_ID}/${giveawayId}`).expect(200)).body,
    );
    expect(one.tokenInfo).toMatchObject({ symbol: "HUSDC", decimals: 6, trust: "unverified" });

    const page = pageSchema(giveawayViewSchema).parse(
      (await request(t.server).get("/giveaways").expect(200)).body,
    );
    expect(page.items[0]?.tokenInfo).toMatchObject({ symbol: "HUSDC", decimals: 6 });

    const claim = claimViewSchema.parse(
      (
        await request(t.server)
          .get(`/claims/${CHAIN_ID}/${giveawayId}/0x00000000000000000000000000000000000000a1`)
          .expect(200)
      ).body,
    );
    expect(claim.tokenInfo).toMatchObject({ symbol: "HUSDC", decimals: 6 });
    expect(t.tokenReads.count).toBe(1);
  });
});

describe("prices", () => {
  it("serves approximate USDT prices for verified tokens", async () => {
    const body = pricesResponseSchema.parse(
      (await request(t.server).get("/prices").expect(200)).body,
    );
    expect(body.currency).toBe("USDT");
    expect(body.prices).toMatchObject({ usd: 1, ethereum: 2000, monad: 0.05 });
  });
});

describe("leaderboards", () => {
  it("is empty until a giveaway is finalized, then ranks winners and hosts", async () => {
    const empty = leaderboardsViewSchema.parse(
      (await request(t.server).get("/leaderboards").expect(200)).body,
    );
    expect(empty.winners).toEqual([]);
    expect(empty.hosts).toEqual([]);
  });

  it("ranks by approximate USDT from confirmed settlements only", async () => {
    const a = "0x00000000000000000000000000000000000000a1" as Address;
    const b = "0x00000000000000000000000000000000000000b2" as Address;
    const { computed } = await createSettledGiveaway(t.db, {
      players: [a, b],
      status: "CONFIRMED",
    });
    // A settlement that isn't final yet doesn't count.
    await createSettledGiveaway(t.db, { players: [a, b] });

    const body = leaderboardsViewSchema.parse(
      (await request(t.server).get("/leaderboards").expect(200)).body,
    );
    expect(body.winners.map((entry) => entry.account).sort()).toEqual(
      computed.payouts.map((payout) => payout.account).sort(),
    );
    expect(body.winners[0]!.rank).toBe(1);
    expect(body.winners[0]!.value).toBeGreaterThan(0);
    expect(body.hosts).toHaveLength(1);
    expect(body.hosts[0]).toMatchObject({ count: 1 });
  });
});
