import { keccak_256 } from "@noble/hashes/sha3.js";
import { canonicalJson, type Hex } from "@fairdrops/shared";

const encoder = new TextEncoder();

/** keccak256 of the canonical (RFC 8785) JSON of `value`: the hash of transcripts and resources. */
export function hashJson(value: unknown): Hex {
  return keccakHex(encoder.encode(canonicalJson(value)));
}

export function keccakHex(bytes: Uint8Array): Hex {
  let hex = "0x";
  for (const byte of keccak_256(bytes)) hex += byte.toString(16).padStart(2, "0");
  return hex as Hex;
}
