import { errorResponseSchema, sessionResponseSchema } from "@fairdrops/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { maskEmail, type PrivyIdentity } from "../src/auth/privy.gateway.js";
import { createTestApp, type TestApp } from "./harness.js";
import { createSession } from "./session-fixtures.js";

let t: TestApp;
const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

function privyUser(token: string, overrides: Partial<PrivyIdentity> = {}): PrivyIdentity {
  const identity: PrivyIdentity = {
    userId: `did:privy:${token}`,
    method: "google",
    handle: "Ada",
    wallet: `0x${token.padStart(40, "0").slice(-40)}`,
    ...overrides,
  };
  t.privyUsers.set(token, identity);
  return identity;
}

async function signInWithPrivy(token: string) {
  const response = await request(t.server)
    .post("/auth/privy")
    .send({ accessToken: token, transport: "body" })
    .expect(200);
  return sessionResponseSchema.parse(response.body);
}

describe("social sign-in through Privy", () => {
  it("creates an account with the embedded wallet on first sign-in, and reuses it", async () => {
    const identity = privyUser("a1");
    const first = await signInWithPrivy("a1");
    expect(first.me.wallet).toBe(identity.wallet);
    expect(first.me.login).toEqual({ method: "google", handle: "Ada" });
    expect(first.me.wallets).toEqual([
      expect.objectContaining({ address: identity.wallet, connector: "privy" }),
    ]);

    const again = await signInWithPrivy("a1");
    expect(again.me.profile.id).toBe(first.me.profile.id);
    await expect(t.db.user.count()).resolves.toBe(1);
  });

  it("treats a Google and a passkey sign-in as two accounts", async () => {
    privyUser("b1", { method: "google" });
    privyUser("b2", { method: "passkey", handle: "iPhone" });
    const google = await signInWithPrivy("b1");
    const passkey = await signInWithPrivy("b2");
    expect(passkey.me.profile.id).not.toBe(google.me.profile.id);
    expect(passkey.me.wallet).not.toBe(google.me.wallet);
    expect(passkey.me.login).toEqual({ method: "passkey", handle: "iPhone" });
  });

  it("shows an email sign-in by a masked address", () => {
    expect(maskEmail("ada@example.com")).toBe("a••••@example.com");
    expect(maskEmail("not-an-email")).toBeNull();
  });

  it("refuses a token Privy doesn't vouch for", async () => {
    const response = await request(t.server)
      .post("/auth/privy")
      .send({ accessToken: "forged", transport: "body" })
      .expect(401);
    expect(errorCode(response.body)).toBe("UNAUTHENTICATED");
  });

  it("keeps how someone signed in across refreshes, and lets them join a game", async () => {
    privyUser("c1", { method: "email", handle: "a••••@example.com" });
    const session = await signInWithPrivy("c1");
    const refreshed = sessionResponseSchema.parse(
      (
        await request(t.server)
          .post("/auth/refresh")
          .send({ refreshToken: session.refreshToken, transport: "body" })
          .expect(200)
      ).body,
    );
    expect(refreshed.me.login).toEqual({ method: "email", handle: "a••••@example.com" });

    const game = await createSession(t.db);
    await request(t.server)
      .post(`/sessions/${game.id}/join`)
      .set("authorization", `Bearer ${refreshed.accessToken}`)
      .expect(200);
  });
});
