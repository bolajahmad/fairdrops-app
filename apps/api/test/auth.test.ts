import {
  LINK_WALLET_STATEMENT,
  errorResponseSchema,
  meResponseSchema,
  sessionResponseSchema,
  wsTicketResponseSchema,
} from "@fairdrops/shared";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStore } from "../src/auth/auth.store.js";
import {
  APP_ORIGIN,
  createTestApp,
  newAccount,
  signIn,
  signedMessage,
  type TestApp,
} from "./harness.js";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

function errorCode(body: unknown): string {
  return errorResponseSchema.parse(body).error.code;
}

describe("sign-in", () => {
  it("creates an account on first sign-in and reuses it afterwards", async () => {
    const first = await signIn(t.server);
    const me = first.session.me;

    expect(me.wallet).toBe(first.account.address.toLowerCase());
    expect(me.profile.displayName).toBe(`Player ${me.wallet.slice(-4)}`);
    expect(me.wallets).toEqual([expect.objectContaining({ kind: "EOA", connector: "web3auth" })]);
    expect(me.roles).toEqual([]);

    const second = await signIn(t.server, first.account);
    expect(second.session.me.profile.id).toBe(me.profile.id);
    expect(await t.db.user.count()).toBe(1);
  });

  it("creates one account when the same wallet signs in twice at once", async () => {
    const account = newAccount();
    const [a, b] = await Promise.all([signIn(t.server, account), signIn(t.server, account)]);
    expect(a.session.me.profile.id).toBe(b.session.me.profile.id);
    expect(await t.db.user.count()).toBe(1);
  });

  it("accepts each nonce once", async () => {
    const signed = await signedMessage(t.server, newAccount());
    await request(t.server).post("/auth/verify").send(signed).expect(200);
    const replay = await request(t.server).post("/auth/verify").send(signed).expect(401);
    expect(errorCode(replay.body)).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["an origin that is not allowed", { origin: "https://evil.example" }],
    ["the wallet-link statement", { statement: LINK_WALLET_STATEMENT }],
    ["an unsupported chain", { chainId: 1 }],
    ["a message issued too long ago", { issuedAt: new Date(Date.now() - 10 * 60_000) }],
    ["an expired message", { expirationTime: new Date(Date.now() - 1000) }],
  ])("rejects %s", async (_label, options) => {
    const signed = await signedMessage(t.server, newAccount(), options);
    const response = await request(t.server).post("/auth/verify").send(signed).expect(401);
    expect(errorCode(response.body)).toBe("UNAUTHENTICATED");
  });

  it("rejects a signature by a different key", async () => {
    const victim = newAccount();
    const signed = await signedMessage(t.server, newAccount(), { address: victim.address });
    await request(t.server).post("/auth/verify").send(signed).expect(401);
    expect(await t.db.wallet.count()).toBe(0);
  });

  it("rejects a nonce issued to another address", async () => {
    const account = newAccount();
    const signed = await signedMessage(t.server, account);
    const other = newAccount();
    const swapped = signed.message.replace(account.address, other.address);
    const response = await request(t.server)
      .post("/auth/verify")
      .send({ message: swapped, signature: await other.signMessage({ message: swapped }) })
      .expect(401);
    expect(errorResponseSchema.parse(response.body).error.message).toMatch(/nonce/);
  });

  it("accepts smart-contract wallets whose signature verifies on-chain", async () => {
    t.contractSignatures.valid = true;
    const contractWallet = newAccount().address;
    const signed = await signedMessage(t.server, newAccount(), { address: contractWallet });
    const response = await request(t.server).post("/auth/verify").send(signed).expect(200);
    const session = sessionResponseSchema.parse(response.body);
    expect(session.me.wallets[0]?.kind).toBe("CONTRACT");
  });

  it("validates request bodies with the shared schemas", async () => {
    const response = await request(t.server)
      .post("/auth/nonce")
      .send({ address: "nope" })
      .expect(400);
    expect(errorCode(response.body)).toBe("VALIDATION_FAILED");
    expect(response.headers["x-request-id"]).toBeDefined();
  });

  it("rate limits nonce requests per client", async () => {
    const address = newAccount().address;
    for (let i = 0; i < 20; i++) {
      await request(t.server).post("/auth/nonce").send({ address }).expect(200);
    }
    const limited = await request(t.server).post("/auth/nonce").send({ address }).expect(429);
    expect(errorCode(limited.body)).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("access tokens", () => {
  it("authenticates /auth/me and rejects missing or forged tokens", async () => {
    const { bearer, session } = await signIn(t.server);
    const response = await request(t.server)
      .get("/auth/me")
      .set("authorization", bearer)
      .expect(200);
    expect(meResponseSchema.parse(response.body).profile.id).toBe(session.me.profile.id);

    expect(errorCode((await request(t.server).get("/auth/me").expect(401)).body)).toBe(
      "UNAUTHENTICATED",
    );
    await request(t.server).get("/auth/me").set("authorization", `${bearer}x`).expect(401);
    await request(t.server).get("/auth/me").set("authorization", "Basic abc").expect(401);
  });

  it("can be verified by third parties with the published JWKS", async () => {
    const { session } = await signIn(t.server);
    const jwks = (await request(t.server).get("/.well-known/jwks.json").expect(200))
      .body as JSONWebKeySet;
    const { payload, protectedHeader } = await jwtVerify(
      session.accessToken,
      createLocalJWKSet(jwks),
      {
        issuer: "fairdrops",
        audience: "fairdrops-api",
      },
    );
    expect(protectedHeader.alg).toBe("ES256");
    expect(payload.sub).toBe(session.me.profile.id);
    expect(payload.wal).toBe(session.me.wallet);
  });

  it("carries the admin role when the wallet holds DEFAULT_ADMIN_ROLE on-chain", async () => {
    const account = newAccount();
    t.admins.add(account.address.toLowerCase() as `0x${string}`);
    const { session } = await signIn(t.server, account);
    expect(session.me.roles).toEqual(["admin"]);
  });
});

describe("refresh tokens", () => {
  it("rotates on every refresh", async () => {
    const { session } = await signIn(t.server);
    const response = await request(t.server)
      .post("/auth/refresh")
      .send({ refreshToken: session.refreshToken, transport: "body" })
      .expect(200);
    const rotated = sessionResponseSchema.parse(response.body);
    expect(rotated.refreshToken).not.toBe(session.refreshToken);
    await request(t.server)
      .get("/auth/me")
      .set("authorization", `Bearer ${rotated.accessToken}`)
      .expect(200);
  });

  it("treats an immediate second use as a race and keeps the newer session", async () => {
    const { session } = await signIn(t.server);
    const body = { refreshToken: session.refreshToken, transport: "body" };
    const rotated = sessionResponseSchema.parse(
      (await request(t.server).post("/auth/refresh").send(body).expect(200)).body,
    );
    await request(t.server).post("/auth/refresh").send(body).expect(401);

    await request(t.server)
      .post("/auth/refresh")
      .send({ refreshToken: rotated.refreshToken, transport: "body" })
      .expect(200);
  });

  it("signs out the whole session family when a rotated token is replayed later", async () => {
    const { session } = await signIn(t.server);
    const stolen = { refreshToken: session.refreshToken, transport: "body" };
    const rotated = sessionResponseSchema.parse(
      (await request(t.server).post("/auth/refresh").send(stolen).expect(200)).body,
    );

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 11_000 });
    await request(t.server).post("/auth/refresh").send(stolen).expect(401);

    await request(t.server)
      .post("/auth/refresh")
      .send({ refreshToken: rotated.refreshToken, transport: "body" })
      .expect(401);
    await request(t.server)
      .get("/auth/me")
      .set("authorization", `Bearer ${rotated.accessToken}`)
      .expect(401);
  });

  it("uses an HttpOnly cookie for the web app and only accepts it from a first-party origin", async () => {
    const signed = await signedMessage(t.server, newAccount());
    const response = await request(t.server).post("/auth/verify").send(signed).expect(200);
    expect(sessionResponseSchema.parse(response.body).refreshToken).toBeUndefined();

    const cookie = response.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/^fd_refresh=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/auth/);
    const pair = cookie.split(";")[0] ?? "";

    await request(t.server).post("/auth/refresh").set("cookie", pair).send({}).expect(403);
    await request(t.server)
      .post("/auth/refresh")
      .set("cookie", pair)
      .set("origin", "https://evil.example")
      .send({})
      .expect(403);
    const refreshed = await request(t.server)
      .post("/auth/refresh")
      .set("cookie", pair)
      .set("origin", APP_ORIGIN)
      .send({})
      .expect(200);
    expect(refreshed.headers["set-cookie"]?.[0]).toMatch(/^fd_refresh=/);
  });

  it("stops working after logout, along with the access token", async () => {
    const { bearer, session } = await signIn(t.server);
    await request(t.server).post("/auth/logout").set("authorization", bearer).expect(204);
    await request(t.server).get("/auth/me").set("authorization", bearer).expect(401);
    await request(t.server)
      .post("/auth/refresh")
      .send({ refreshToken: session.refreshToken, transport: "body" })
      .expect(401);
  });
});

describe("WebSocket tickets", () => {
  it("issues single-use tickets bound to the caller", async () => {
    const { bearer, session } = await signIn(t.server);
    const response = await request(t.server)
      .post("/auth/ws-ticket")
      .set("authorization", bearer)
      .expect(200);
    const { ticket } = wsTicketResponseSchema.parse(response.body);

    const store = t.app.get(AuthStore);
    expect(await store.consumeWsTicket(ticket)).toMatchObject({
      userId: session.me.profile.id,
      wallet: session.me.wallet,
    });
    expect(await store.consumeWsTicket(ticket)).toBeNull();
  });
});
