import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";

const SEED = `0x${"ab".repeat(32)}` as const;

/** The stream as the spec in rng.ts describes it, built with Node's own SHA-256. */
function specBlock(label: string, counter: number): Buffer {
  const labelBytes = Buffer.from(label, "utf8");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(labelBytes.length);
  const index = Buffer.alloc(4);
  index.writeUInt32BE(counter);
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(SEED.slice(2), "hex"), length, labelBytes, index]))
    .digest();
}

describe("Rng", () => {
  it("follows the published stream specification", () => {
    const rng = Rng.fromSeed(SEED);
    const expected = Buffer.concat([specBlock("root", 0), specBlock("root", 1)]);
    for (let i = 0; i < 16; i++) expect(rng.uint32()).toBe(expected.readUInt32BE(i * 4));
  });

  it("labels forks by path, independent of how much the parent consumed", () => {
    const fresh = Rng.fromSeed(SEED).fork("dice").fork("0x01");
    const used = Rng.fromSeed(SEED);
    for (let i = 0; i < 50; i++) used.uint32();
    expect(fresh.label).toBe("root/dice/0x01");
    expect(used.fork("dice").fork("0x01").uint32()).toBe(fresh.uint32());
    expect(Rng.fromSeed(SEED).fork("a").uint32()).not.toBe(Rng.fromSeed(SEED).fork("b").uint32());
  });

  it("draws integers in range, covering every value", () => {
    const rng = Rng.fromSeed(SEED);
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const value = rng.int(6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
    expect(() => rng.int(0)).toThrow(RangeError);
  });

  it("shuffles into a permutation, the same way for the same seed", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const a = Rng.fromSeed(SEED).shuffle(items);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(Rng.fromSeed(SEED).shuffle(items)).toEqual(a);
    expect(a).not.toEqual(items);
  });

  it("rejects malformed seeds", () => {
    expect(() => Rng.fromSeed("0x1234")).toThrow("32-byte");
  });
});
