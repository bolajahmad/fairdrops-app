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
    expect(addressSchema.parse("0x5cA0A86a6110917A5bB1170b0A18FD880Aa8dE72")).toBe(
      "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72",
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
