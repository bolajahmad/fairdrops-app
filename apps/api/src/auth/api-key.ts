import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const FORMAT = /^(fd_live_[a-z0-9]{8})_[A-Za-z0-9_-]{43}$/;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export interface GeneratedApiKey {
  /** The full key, shown to the owner once. */
  secret: string;
  /** Stored in the clear and unique, used to find the key. */
  prefix: string;
  /** SHA-256 of the full key, the only secret material stored. */
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const id = Array.from(randomBytes(8), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
  const prefix = `fd_live_${id}`;
  const secret = `${prefix}_${randomBytes(32).toString("base64url")}`;
  return { secret, prefix, hash: hashApiKey(secret) };
}

export function parseApiKeyPrefix(key: string): string | null {
  return FORMAT.exec(key)?.[1] ?? null;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function apiKeyMatches(key: string, storedHash: string): boolean {
  const actual = Buffer.from(hashApiKey(key), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
