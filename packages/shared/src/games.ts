import { z } from "zod";
import {
  addressSchema,
  bytes32Schema,
  httpsUrlSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
  uuidSchema,
} from "./primitives.js";

/** A game's slug, e.g. "quiz" or "tap-race". */
export const gameIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Use 3 to 40 lowercase letters, numbers or hyphens");

export const semverSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Expected a version such as 1.0.0");

/**
 * HOSTED games run inside FairDrops from a deterministic definition, so anyone can replay the
 * result. EXTERNAL games run on the developer's server, which submits signed score reports.
 */
export const gameModeSchema = z.enum(["HOSTED", "EXTERNAL"]);
export type GameMode = z.infer<typeof gameModeSchema>;

/**
 * DRAFT is editable by its owner. PENDING_REVIEW waits for an admin. APPROVED is immutable and
 * playable; changes need a new version. DISABLED can no longer be chosen for new giveaways.
 */
export const gameDefinitionStatusSchema = z.enum([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "DISABLED",
]);
export type GameDefinitionStatus = z.infer<typeof gameDefinitionStatusSchema>;

export const sessionStatusSchema = z.enum([
  "SCHEDULED",
  "SEED_COMMITTED",
  "LOBBY",
  "RUNNING",
  "SETTLING",
  "FINALIZING",
  "FINALIZED",
  "CANCELLED",
  "FAILED",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

const MAX_CONFIG_SCHEMA_BYTES = 16 * 1024;

/** The JSON Schema describing the settings a host picks for this game. */
export const configSchemaSchema = z
  .record(z.string(), z.unknown())
  .refine((schema) => schema.type === "object", 'The top-level schema must have "type": "object"')
  .refine(
    (schema) => new TextEncoder().encode(JSON.stringify(schema)).length <= MAX_CONFIG_SCHEMA_BYTES,
    `Must be at most ${MAX_CONFIG_SCHEMA_BYTES} bytes`,
  );

const editableFields = {
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000),
  configSchema: configSchemaSchema,
  uiUrl: httpsUrlSchema.nullable(),
  reporterAddress: addressSchema.nullable(),
  codeHash: bytes32Schema.nullable(),
};

export const createGameDefinitionRequestSchema = z
  .object({
    id: gameIdSchema,
    version: semverSchema,
    mode: gameModeSchema,
    ...editableFields,
    uiUrl: editableFields.uiUrl.default(null),
    reporterAddress: editableFields.reporterAddress.default(null),
    codeHash: editableFields.codeHash.default(null),
  })
  .superRefine(checkModeFields);
export type CreateGameDefinitionRequest = z.infer<typeof createGameDefinitionRequestSchema>;

export const updateGameDefinitionRequestSchema = z
  .object(editableFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateGameDefinitionRequest = z.infer<typeof updateGameDefinitionRequestSchema>;

export const reviewGameDefinitionRequestSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ReviewGameDefinitionRequest = z.infer<typeof reviewGameDefinitionRequestSchema>;

export interface ModeFields {
  mode: GameMode;
  reporterAddress: string | null;
}

/** External games must name the key that signs their score reports; hosted games must not. */
export function modeFieldIssues(fields: ModeFields): string[] {
  if (fields.mode === "EXTERNAL" && !fields.reporterAddress) {
    return ["External games need a reporterAddress to sign score reports"];
  }
  if (fields.mode === "HOSTED" && fields.reporterAddress) {
    return ["Hosted games are scored by FairDrops and take no reporterAddress"];
  }
  return [];
}

function checkModeFields(fields: ModeFields, ctx: z.RefinementCtx): void {
  for (const message of modeFieldIssues(fields)) {
    ctx.addIssue({ code: "custom", message, path: ["reporterAddress"] });
  }
}

export const gameDefinitionViewSchema = z.object({
  id: gameIdSchema,
  version: semverSchema,
  name: z.string(),
  description: z.string(),
  mode: gameModeSchema,
  status: gameDefinitionStatusSchema,
  configSchema: z.record(z.string(), z.unknown()),
  uiUrl: z.string().nullable(),
  reporterAddress: addressSchema.nullable(),
  codeHash: bytes32Schema.nullable(),
  ownerId: uuidSchema,
  reviewNote: z.string().nullable(),
  submittedAt: isoDateTimeSchema.nullable(),
  reviewedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type GameDefinitionView = z.infer<typeof gameDefinitionViewSchema>;

export const gameDefinitionListQuerySchema = paginationQuerySchema.extend({
  /** "mine" lists the caller's own definitions in every status. */
  owner: z.literal("mine").optional(),
  status: gameDefinitionStatusSchema.optional(),
});
export type GameDefinitionListQuery = z.infer<typeof gameDefinitionListQuerySchema>;

/**
 * Private content a game draws on, such as a quiz's question bank, uploaded by an admin and
 * referenced by hash in a giveaway's settings. It stays private until a game that used it is
 * over, when its transcript publishes it.
 */
export const createGameResourceRequestSchema = z.object({
  kind: gameIdSchema,
  content: z.unknown(),
});
export type CreateGameResourceRequest = z.infer<typeof createGameResourceRequestSchema>;

export const gameResourceViewSchema = z.object({
  hash: bytes32Schema,
  kind: z.string(),
  summary: z.string(),
  createdAt: isoDateTimeSchema,
});
export type GameResourceView = z.infer<typeof gameResourceViewSchema>;
