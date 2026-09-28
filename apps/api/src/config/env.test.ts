import { describe, expect, it } from "vitest";
import { parseApiEnv } from "./env.js";

const base = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" };

describe("parseApiEnv", () => {
  it("treats empty values as unset", () => {
    const env = parseApiEnv({ ...base, AUTH_JWT_PRIVATE_JWK: "", LOCAL_ADMIN_ADDRESSES: "" });
    expect(env.AUTH_JWT_PRIVATE_JWK).toBeUndefined();
    expect(env.LOCAL_ADMIN_ADDRESSES).toEqual([]);
  });

  it("normalizes origins and requires a signing key in production", () => {
    expect(
      parseApiEnv({ ...base, APP_ORIGINS: "https://fairdrops.xyz/, http://localhost:3000" })
        .APP_ORIGINS,
    ).toEqual(["https://fairdrops.xyz", "http://localhost:3000"]);
    expect(() => parseApiEnv({ ...base, NODE_ENV: "production" })).toThrow(/AUTH_JWT_PRIVATE_JWK/);
    expect(
      parseApiEnv({ ...base, NODE_ENV: "production", AUTH_JWT_PRIVATE_JWK: "{}" })
        .AUTH_COOKIE_SECURE,
    ).toBe(true);
  });

  it("only accepts configured admins in the local environment", () => {
    const admin = "0x40E79f68ae9AD9A28942050c5158A26d9c9e60CA";
    expect(() => parseApiEnv({ ...base, LOCAL_ADMIN_ADDRESSES: admin })).toThrow(
      /LOCAL_ADMIN_ADDRESSES/,
    );
    expect(
      parseApiEnv({ ...base, DEPLOYMENT_ENVIRONMENT: "local", LOCAL_ADMIN_ADDRESSES: admin })
        .LOCAL_ADMIN_ADDRESSES,
    ).toEqual([admin.toLowerCase()]);
  });
});
