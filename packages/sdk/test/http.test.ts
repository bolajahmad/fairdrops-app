import { describe, expect, it } from "vitest";
import { sessionResponseSchema } from "@fairdrops/shared";
import { z } from "zod";
import { FairDropsError } from "../src/errors.js";
import { HttpClient } from "../src/http.js";

const API = "https://api.test";
const soon = (ms: number) => new Date(Date.now() + ms).toISOString();

function session(accessToken: string, refreshToken = `refresh-${accessToken}`) {
  return sessionResponseSchema.parse({
    accessToken,
    accessTokenExpiresAt: soon(15 * 60_000),
    refreshToken,
    refreshTokenExpiresAt: soon(30 * 86_400_000),
    me: {
      profile: {
        id: "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
        handle: null,
        displayName: "Player",
        bio: null,
        avatarUrl: null,
        socials: [],
        wallets: [],
        createdAt: new Date().toISOString(),
      },
      wallets: [],
      wallet: "0x00000000000000000000000000000000000000a1",
      roles: [],
      login: { method: "wallet", handle: null },
    },
  });
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("HttpClient", () => {
  it("validates responses against their schema", async () => {
    const { fetchImpl } = stubFetch(() => json({ id: 1 }));
    const http = new HttpClient({ apiUrl: API, fetch: fetchImpl });
    await expect(http.get("/x", { schema: z.object({ id: z.number() }) })).resolves.toEqual({
      id: 1,
    });
    await expect(http.get("/x", { schema: z.object({ id: z.string() }) })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("turns the API's error envelope into a FairDropsError with its code", async () => {
    const { fetchImpl } = stubFetch(() =>
      json({ error: { code: "CONFLICT", message: "Too late", requestId: "r1" } }, 409),
    );
    const http = new HttpClient({ apiUrl: API, fetch: fetchImpl });
    const error = await http.get("/x", { schema: z.unknown() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FairDropsError);
    expect(error).toMatchObject({ code: "CONFLICT", status: 409, requestId: "r1" });
  });

  it("refuses signed-in routes without a session, without calling the API", async () => {
    const { calls, fetchImpl } = stubFetch(() => json({}));
    const http = new HttpClient({ apiUrl: API, fetch: fetchImpl });
    await expect(http.get("/me", { schema: z.unknown(), auth: "required" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(calls).toHaveLength(0);
  });

  it("refreshes an expiring token once for concurrent requests", async () => {
    let refreshes = 0;
    const { calls, fetchImpl } = stubFetch((url, init) => {
      if (url.pathname === "/auth/refresh") {
        refreshes += 1;
        const body = JSON.parse(init.body as string) as { refreshToken: string };
        expect(body.refreshToken).toBe("refresh-old");
        return json(session("new"));
      }
      return json({ auth: (init.headers as Record<string, string>).authorization });
    });
    const http = new HttpClient({ apiUrl: API, fetch: fetchImpl });
    http.tokens.set({
      accessToken: "old",
      accessTokenExpiresAt: soon(5_000),
      refreshToken: "refresh-old",
    });

    const schema = z.object({ auth: z.string() });
    const results = await Promise.all(
      [1, 2, 3].map(() => http.get("/x", { schema, auth: "required" })),
    );
    expect(refreshes).toBe(1);
    expect(results.every((r) => r.auth === "Bearer new")).toBe(true);
    expect(http.tokens.get()?.refreshToken).toBe("refresh-new");
    expect(calls.filter((c) => c.url.pathname === "/x")).toHaveLength(3);
  });

  it("retries once with a fresh token when the API says the token is no good", async () => {
    let first = true;
    const { fetchImpl } = stubFetch((url) => {
      if (url.pathname === "/auth/refresh") return json(session("fresh"));
      if (first) {
        first = false;
        return json({ error: { code: "UNAUTHENTICATED", message: "revoked" } }, 401);
      }
      return json({ ok: true });
    });
    const http = new HttpClient({ apiUrl: API, fetch: fetchImpl });
    http.accept(session("stale"));
    await expect(
      http.get("/x", { schema: z.object({ ok: z.boolean() }), auth: "required" }),
    ).resolves.toEqual({ ok: true });
  });

  it("signs out locally when the refresh token is rejected", async () => {
    const { fetchImpl } = stubFetch(() =>
      json({ error: { code: "UNAUTHENTICATED", message: "reused" } }, 401),
    );
    const http = new HttpClient({ apiUrl: API, fetch: fetchImpl });
    http.tokens.set({ accessToken: "a", accessTokenExpiresAt: soon(0), refreshToken: "r" });
    await expect(http.accessToken()).resolves.toBeNull();
    expect(http.tokens.get()).toBeNull();
  });

  it("sends the API key only on routes that take one", async () => {
    const { calls, fetchImpl } = stubFetch(() => json({}));
    const http = new HttpClient({ apiUrl: API, fetch: fetchImpl, apiKey: "fd_live_x" });
    await http.get("/public", { schema: z.unknown() });
    await http.post("/report", { schema: z.unknown(), apiKey: true, body: {} });
    const headers = calls.map((c) => (c.init.headers as Record<string, string>)["x-api-key"]);
    expect(headers).toEqual([undefined, "fd_live_x"]);
  });
});
