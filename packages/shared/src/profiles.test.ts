import { describe, expect, it } from "vitest";
import {
  defaultDisplayName,
  handleSchema,
  normalizeSocialHandle,
  socialUrl,
  updateProfileRequestSchema,
} from "./profiles.js";

describe("handles", () => {
  it("lowercases and validates handles", () => {
    expect(handleSchema.parse("  Ada_Lovelace ")).toBe("ada_lovelace");
    expect(handleSchema.safeParse("ab").success).toBe(false);
    expect(handleSchema.safeParse("has space").success).toBe(false);
    expect(handleSchema.safeParse("Admin").success).toBe(false);
  });
});

describe("social links", () => {
  it("accepts bare handles, @handles and profile URLs", () => {
    expect(normalizeSocialHandle("x", "@fair_drops")).toBe("fair_drops");
    expect(normalizeSocialHandle("x", "https://twitter.com/fair_drops")).toBe("fair_drops");
    expect(normalizeSocialHandle("instagram", "https://www.instagram.com/fair.drops/")).toBe(
      "fair.drops",
    );
    expect(normalizeSocialHandle("tiktok", "https://www.tiktok.com/@fairdrops")).toBe("fairdrops");
    expect(normalizeSocialHandle("website", "https://fairdrops.xyz")).toBe("https://fairdrops.xyz");
  });

  it("rejects URLs from the wrong site and malformed handles", () => {
    expect(normalizeSocialHandle("x", "https://instagram.com/fairdrops")).toBeNull();
    expect(normalizeSocialHandle("x", "this handle is far too long")).toBeNull();
    expect(normalizeSocialHandle("website", "http://insecure.example")).toBeNull();
  });

  it("builds profile links where the platform has them", () => {
    expect(socialUrl("x", "fairdrops")).toBe("https://x.com/fairdrops");
    expect(socialUrl("discord", "fairdrops")).toBeNull();
  });

  it("rejects duplicate platforms and empty updates", () => {
    expect(
      updateProfileRequestSchema.safeParse({
        socials: [
          { platform: "x", handle: "a_b" },
          { platform: "x", handle: "c_d" },
        ],
      }).success,
    ).toBe(false);
    expect(updateProfileRequestSchema.safeParse({}).success).toBe(false);
  });

  it("normalizes socials inside a profile update", () => {
    const body = updateProfileRequestSchema.parse({
      socials: [{ platform: "github", handle: "https://github.com/fairdrops" }],
    });
    expect(body.socials).toEqual([{ platform: "github", handle: "fairdrops" }]);
  });
});

describe("defaultDisplayName", () => {
  it("uses the end of the address", () => {
    expect(defaultDisplayName("0x40E79f68ae9AD9A28942050c5158A26d9c9e60CA")).toBe("Player 60ca");
  });
});
