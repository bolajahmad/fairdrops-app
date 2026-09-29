import { sha256 } from "@noble/hashes/sha2.js";
import type { Hex } from "@fairdrops/shared";

const encoder = new TextEncoder();

/**
 * Deterministic randomness derived from the session seed. This is the only source of randomness
 * a hosted game may use, so anyone holding the revealed seed can replay the game exactly.
 *
 * A stream is identified by a label. Its bytes are the concatenation of
 *
 *   block(i) = sha256(seed || uint16be(len(label)) || utf8(label) || uint32be(i)),  i = 0, 1, ...
 *
 * consumed in order. `uint32()` reads the next 4 bytes big-endian, and `int(n)` rejects values
 * at or above floor(2^32 / n) * n so every result is equally likely. `fork(name)` is the stream
 * labelled `<label>/<name>`, independent of how much the parent has consumed.
 */
export class Rng {
  private buffer = new Uint8Array(0);
  private offset = 0;
  private counter = 0;

  private constructor(
    private readonly seed: Uint8Array,
    readonly label: string,
  ) {
    if (seed.length !== 32) throw new RangeError("The seed must be 32 bytes");
    if (encoder.encode(label).length > 0xffff) throw new RangeError("Label too long");
  }

  static fromSeed(seed: Hex, label = "root"): Rng {
    return new Rng(hexToBytes(seed), label);
  }

  fork(name: string): Rng {
    return new Rng(this.seed, `${this.label}/${name}`);
  }

  uint32(): number {
    if (this.offset + 4 > this.buffer.length) this.refill();
    const b = this.buffer;
    const i = this.offset;
    this.offset += 4;
    return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  }

  /** A uniform integer in [0, n). */
  int(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`Invalid range ${n}`);
    const limit = Math.floor(2 ** 32 / n) * n;
    for (;;) {
      const value = this.uint32();
      if (value < limit) return value % n;
    }
  }

  /** A shuffled copy, by Fisher-Yates from the last index down. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  private refill(): void {
    const label = encoder.encode(this.label);
    const input = new Uint8Array(32 + 2 + label.length + 4);
    input.set(this.seed, 0);
    new DataView(input.buffer).setUint16(32, label.length);
    input.set(label, 34);
    new DataView(input.buffer).setUint32(34 + label.length, this.counter);
    this.counter += 1;
    const block = sha256(input);
    // Keep any unread bytes so a read never skips part of the stream.
    const rest = this.buffer.subarray(this.offset);
    const next = new Uint8Array(rest.length + block.length);
    next.set(rest, 0);
    next.set(block, rest.length);
    this.buffer = next;
    this.offset = 0;
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new TypeError("Expected a 32-byte hex seed");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return bytes;
}
