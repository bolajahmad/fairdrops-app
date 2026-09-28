import {
  LINK_WALLET_STATEMENT,
  errorResponseSchema,
  profileViewSchema,
  walletViewSchema,
} from "@fairdrops/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestApp, newAccount, signIn, signedMessage, type TestApp } from "./harness.js";

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

const walletsSchema = z.array(walletViewSchema);

async function patchMe(bearer: string, body: object, status = 200) {
  return request(t.server)
    .patch("/profiles/me")
    .set("authorization", bearer)
    .send(body)
    .expect(status);
}

describe("profiles", () => {
  it("updates the profile and normalizes pasted social links", async () => {
    const { bearer, session } = await signIn(t.server);
    const response = await patchMe(bearer, {
      handle: "Ada_Plays",
      displayName: "Ada",
      bio: "Quiz enthusiast",
      socials: [
        { platform: "x", handle: "https://x.com/ada_plays" },
        { platform: "instagram", handle: "@ada.plays" },
      ],
    });
    const profile = profileViewSchema.parse(response.body);

    expect(profile).toMatchObject({
      handle: "ada_plays",
      displayName: "Ada",
      bio: "Quiz enthusiast",
    });
    expect(profile.socials).toEqual([
      { platform: "x", handle: "ada_plays", url: "https://x.com/ada_plays", verifiedAt: null },
      {
        platform: "instagram",
        handle: "ada.plays",
        url: "https://instagram.com/ada.plays",
        verifiedAt: null,
      },
    ]);

    const byHandle = await request(t.server).get("/profiles/handle/ada_plays").expect(200);
    expect(profileViewSchema.parse(byHandle.body).id).toBe(session.me.profile.id);
    const byWallet = await request(t.server)
      .get(`/profiles/wallet/${session.me.wallet}`)
      .expect(200);
    expect(profileViewSchema.parse(byWallet.body).handle).toBe("ada_plays");
  });

  it("replaces the whole set of social links", async () => {
    const { bearer } = await signIn(t.server);
    await patchMe(bearer, { socials: [{ platform: "x", handle: "first_one" }] });
    const response = await patchMe(bearer, {
      socials: [{ platform: "github", handle: "fairdrops" }],
    });
    expect(profileViewSchema.parse(response.body).socials.map((s) => s.platform)).toEqual([
      "github",
    ]);
  });

  it("rejects invalid social handles with a validation error", async () => {
    const { bearer } = await signIn(t.server);
    const response = await patchMe(
      bearer,
      { socials: [{ platform: "x", handle: "https://evil.example/x" }] },
      400,
    );
    expect(errorResponseSchema.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("keeps handles unique", async () => {
    const first = await signIn(t.server);
    const second = await signIn(t.server);
    await patchMe(first.bearer, { handle: "taken_name" });
    const response = await patchMe(second.bearer, { handle: "TAKEN_NAME" }, 409);
    expect(errorResponseSchema.parse(response.body).error.message).toMatch(/taken/);
  });

  it("allows one handle change every 30 days", async () => {
    const { bearer } = await signIn(t.server);
    await patchMe(bearer, { handle: "first_handle" });
    const blocked = await patchMe(bearer, { handle: "second_handle" }, 409);
    expect(errorResponseSchema.parse(blocked.body).error.details).toHaveProperty("nextChangeAt");

    const unchanged = await patchMe(bearer, {
      handle: "first_handle",
      displayName: "Other fields",
    });
    expect(profileViewSchema.parse(unchanged.body)).toMatchObject({
      handle: "first_handle",
      displayName: "Other fields",
    });
  });

  it("lets a handle change again once the cooldown has passed", async () => {
    const { bearer, session } = await signIn(t.server);
    await patchMe(bearer, { handle: "first_handle" });
    await t.db.user.update({
      where: { id: session.me.profile.id },
      data: { handleChangedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    const response = await patchMe(bearer, { handle: "second_handle" });
    expect(profileViewSchema.parse(response.body).handle).toBe("second_handle");
  });

  it("returns 404 for unknown profiles", async () => {
    await request(t.server).get("/profiles/handle/nobody_here").expect(404);
    await request(t.server).get(`/profiles/wallet/${newAccount().address}`).expect(404);
  });
});

describe("wallets", () => {
  async function link(bearer: string, statement = LINK_WALLET_STATEMENT, account = newAccount()) {
    const signed = await signedMessage(t.server, account, { statement });
    return {
      account,
      response: await request(t.server).post("/wallets").set("authorization", bearer).send(signed),
    };
  }

  it("links a second wallet that signs a link message", async () => {
    const { bearer, session } = await signIn(t.server);
    const { account, response } = await link(bearer);
    expect(response.status).toBe(201);
    expect(walletsSchema.parse(response.body).map((w) => w.address)).toEqual([
      session.me.wallet,
      account.address.toLowerCase(),
    ]);

    const again = await signIn(t.server, account);
    expect(again.session.me.profile.id).toBe(session.me.profile.id);
  });

  it("refuses a sign-in message as proof for linking", async () => {
    const { bearer } = await signIn(t.server);
    const { response } = await link(bearer, "Sign in to FairDrops.");
    expect(response.status).toBe(401);
  });

  it("refuses a wallet that belongs to another account", async () => {
    const other = await signIn(t.server);
    const { bearer } = await signIn(t.server);
    const { response } = await link(bearer, LINK_WALLET_STATEMENT, other.account);
    expect(response.status).toBe(409);
  });

  it("cannot remove the wallet the session is signed in with", async () => {
    const { bearer, session } = await signIn(t.server);
    await request(t.server)
      .delete(`/wallets/${session.me.wallet}`)
      .set("authorization", bearer)
      .expect(409);
  });

  it("removes a wallet and signs out the sessions that used it", async () => {
    const primary = await signIn(t.server);
    const { account } = await link(primary.bearer);
    const viaSecond = await signIn(t.server, account);
    await request(t.server).get("/auth/me").set("authorization", viaSecond.bearer).expect(200);

    const response = await request(t.server)
      .delete(`/wallets/${account.address}`)
      .set("authorization", primary.bearer)
      .expect(200);
    expect(walletsSchema.parse(response.body)).toHaveLength(1);
    await request(t.server).get("/auth/me").set("authorization", viaSecond.bearer).expect(401);
  });
});
