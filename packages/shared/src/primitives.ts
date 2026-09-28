import { z } from "zod";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

const UINT256_MAX = 2n ** 256n - 1n;

/** A 20-byte hex address, normalized to lowercase. */
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 20-byte hex address")
  .transform((value) => value.toLowerCase() as Address);

/** A 32-byte hex value such as a hash or giveaway id, normalized to lowercase. */
export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte hex value")
  .transform((value) => value.toLowerCase() as Hex);

export const hexSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, "Expected an even-length hex string")
  .transform((value) => value.toLowerCase() as Hex);

/**
 * A uint256 as a decimal string. Token amounts cross every boundary in this form, because
 * JSON numbers lose precision above 2^53.
 */
export const uint256Schema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "Expected a non-negative integer as a decimal string")
  // zod still runs refinements after a failed regex, so only range-check well-formed input.
  .refine(
    (value) => !/^[0-9]+$/.test(value) || (value.length <= 78 && BigInt(value) <= UINT256_MAX),
    "Exceeds uint256",
  );

export const chainIdSchema = z.coerce.number().int().positive();

export const uuidSchema = z.uuid();

export const isoDateTimeSchema = z.iso.datetime();

export const httpsUrlSchema = z
  .url()
  .max(500)
  .refine((value) => value.startsWith("https://"), "Expected an https URL");

export function toUint256String(value: bigint): string {
  if (value < 0n || value > UINT256_MAX) throw new RangeError("Value is outside the uint256 range");
  return value.toString(10);
}

export function parseUint256(value: string): bigint {
  return BigInt(uint256Schema.parse(value));
}

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Cursor-based page. Offset pagination skips and repeats rows while new rows are inserted. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
