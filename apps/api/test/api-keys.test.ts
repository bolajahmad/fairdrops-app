import { apiKeyIdentitySchema, apiKeyViewSchema, createdApiKeySchema } from "@fairdrops/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestApp, signIn, type TestApp } from "./harness.js";

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

async function createKey(
  bearer: string,
  body: object = { name: "Game server", scopes: ["scores:write"] },
) {
  return request(t.server).post("/api-keys").set("authorization", bearer).send(body);
}

describe("API keys", () => {
  it("shows the secret once and authenticates game servers with it", async () => {
    const dev = await signIn(t.server);
    const created = createdApiKeySchema.parse((await createKey(dev.bearer)).body);
    expect(created.secret.startsWith(`${created.prefix}_`)).toBe(true);

    const listed = z
      .array(apiKeyViewSchema)
      .parse(
        (await request(t.server).get("/api-keys").set("authorization", dev.bearer).expect(200))
          .body,
      );
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.secret);

    const whoami = await request(t.server)
      .get("/api-keys/whoami")
      .set("x-api-key", created.secret)
      .expect(200);
    expect(apiKeyIdentitySchema.parse(whoami.body)).toEqual({
      keyId: created.id,
      ownerId: dev.session.me.profile.id,
      scopes: ["scores:write"],
    });

    const stored = await t.db.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.secretHash).not.toContain(created.secret);
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it("rejects revoked, expired, malformed and tampered keys", async () => {
    const dev = await signIn(t.server);
    const created = createdApiKeySchema.parse((await createKey(dev.bearer)).body);

    await request(t.server).get("/api-keys/whoami").set("x-api-key", "fd_live_nope").expect(401);
    await request(t.server)
      .get("/api-keys/whoami")
      .set("x-api-key", `${created.secret.slice(0, -1)}${created.secret.endsWith("A") ? "B" : "A"}`)
      .expect(401);

    await t.db.apiKey.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(t.server).get("/api-keys/whoami").set("x-api-key", created.secret).expect(401);

    await t.db.apiKey.update({ where: { id: created.id }, data: { expiresAt: null } });
    await request(t.server).get("/api-keys/whoami").set("x-api-key", created.secret).expect(200);
    await request(t.server)
      .delete(`/api-keys/${created.id}`)
      .set("authorization", dev.bearer)
      .expect(200);
    await request(t.server).get("/api-keys/whoami").set("x-api-key", created.secret).expect(401);
  });

  it("only lets owners revoke their own keys", async () => {
    const owner = await signIn(t.server);
    const other = await signIn(t.server);
    const created = createdApiKeySchema.parse((await createKey(owner.bearer)).body);
    await request(t.server)
      .delete(`/api-keys/${created.id}`)
      .set("authorization", other.bearer)
      .expect(404);
    await request(t.server).get("/api-keys/whoami").set("x-api-key", created.secret).expect(200);
  });

  it("caps the number of active keys", async () => {
    const dev = await signIn(t.server);
    for (let i = 0; i < 10; i++) {
      expect(
        (await createKey(dev.bearer, { name: `k${i}`, scopes: ["sessions:read"] })).status,
      ).toBe(201);
    }
    // The eleventh call would also hit the per-minute rate limit; clear it to reach the cap.
    const counters = await t.redis.keys("ratelimit:api-key-create:*");
    await t.redis.del(...counters);
    expect((await createKey(dev.bearer)).status).toBe(409);
  });

  it("validates scopes", async () => {
    const dev = await signIn(t.server);
    expect((await createKey(dev.bearer, { name: "bad", scopes: ["everything"] })).status).toBe(400);
    expect((await createKey(dev.bearer, { name: "none", scopes: [] })).status).toBe(400);
  });
});
