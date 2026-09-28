import { describe, expect, it } from "vitest";
import {
  addressSchema,
  bytes32Schema,
  pageSchema,
  parseUint256,
  toUint256String,
  uint256Schema,
} from "./primitives.js";
import { z } from "zod";

describe("primitives", () => {
  it("normalizes addresses and hashes to lowercase", () => {
    expect(addressSchema.parse("0x40E79f68ae9AD9A28942050c5158A26d9c9e60CA")).toBe(
      "0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca",
    );
    expect(bytes32Schema.parse(`0x${"AB".repeat(32)}`)).toBe(`0x${"ab".repeat(32)}`);
    expect(addressSchema.safeParse("0x123").success).toBe(false);
  });

  it("accepts exactly the uint256 range as decimal strings", () => {
    const max = (2n ** 256n - 1n).toString();
    expect(uint256Schema.safeParse("0").success).toBe(true);
    expect(uint256Schema.safeParse(max).success).toBe(true);
    expect(uint256Schema.safeParse((2n ** 256n).toString()).success).toBe(false);
    expect(uint256Schema.safeParse("01").success).toBe(false);
    expect(uint256Schema.safeParse("-1").success).toBe(false);
    expect(uint256Schema.safeParse("1.5").success).toBe(false);
  });

  it("round-trips bigint amounts without losing precision", () => {
    const amount = 123456789012345678901234567890n;
    expect(parseUint256(toUint256String(amount))).toBe(amount);
    expect(() => toUint256String(-1n)).toThrow(RangeError);
  });

  it("builds cursor pages", () => {
    const page = pageSchema(z.number()).parse({ items: [1, 2], nextCursor: null });
    expect(page.items).toEqual([1, 2]);
  });
});
