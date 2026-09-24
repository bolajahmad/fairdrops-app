import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./health.js";

describe("healthResponseSchema", () => {
  const valid = {
    service: "api",
    status: "ok",
    version: "0.0.0",
    uptimeSeconds: 1.5,
    timestamp: "2026-09-24T12:00:00.000Z",
  };

  it("accepts a well-formed payload", () => {
    expect(healthResponseSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an unknown service", () => {
    expect(healthResponseSchema.safeParse({ ...valid, service: "indexer" }).success).toBe(false);
  });

  it("rejects a non ISO timestamp", () => {
    expect(healthResponseSchema.safeParse({ ...valid, timestamp: "yesterday" }).success).toBe(
      false,
    );
  });
});
