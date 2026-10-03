import { z } from "zod";
import { addressSchema, hexSchema, isoDateTimeSchema, uuidSchema } from "./primitives.js";
import { profileViewSchema, walletConnectorSchema, walletViewSchema } from "./profiles.js";

/** The statement shown in the wallet when signing in. */
export const SIGN_IN_STATEMENT = "Sign in to FairDrops.";

/**
 * The statement for proving control of a wallet being linked to an existing account. It differs
 * from the sign-in statement so a signature made for one purpose cannot be used for the other.
 */
export const LINK_WALLET_STATEMENT = "Link this wallet to my FairDrops account.";

export const AUTH_LIFETIMES = {
  nonceSeconds: 5 * 60,
  accessTokenSeconds: 15 * 60,
  refreshTokenSeconds: 30 * 24 * 60 * 60,
  wsTicketSeconds: 60,
  /** Oldest `issuedAt` accepted in a sign-in message. */
  messageMaxAgeSeconds: 5 * 60,
} as const;

export const roleSchema = z.enum(["admin"]);
export type Role = z.infer<typeof roleSchema>;

export const nonceRequestSchema = z.object({ address: addressSchema });
export type NonceRequest = z.infer<typeof nonceRequestSchema>;

export const nonceResponseSchema = z.object({
  nonce: z.string(),
  expiresAt: isoDateTimeSchema,
});
export type NonceResponse = z.infer<typeof nonceResponseSchema>;

/**
 * `cookie` (the web app) keeps the refresh token in an HttpOnly cookie. `body` is for clients on
 * other origins, such as third-party game UIs using the SDK.
 */
export const tokenTransportSchema = z.enum(["cookie", "body"]);
export type TokenTransport = z.infer<typeof tokenTransportSchema>;

/** A signed EIP-4361 (Sign-In with Ethereum) message. */
export const signedMessageSchema = z.object({
  message: z.string().min(1).max(4000),
  signature: hexSchema,
});

export const verifyRequestSchema = signedMessageSchema.extend({
  connector: walletConnectorSchema.default("other"),
  transport: tokenTransportSchema.default("cookie"),
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

/**
 * How someone signed in. Everything except a wallet goes through Privy and comes with an
 * embedded wallet.
 */
export const loginMethodSchema = z.enum(["wallet", "google", "email", "passkey"]);
export type LoginMethod = z.infer<typeof loginMethodSchema>;

/**
 * `POST /auth/privy`: trade a Privy access token for a FairDrops session. The API checks the
 * token with Privy and reads the person's account from Privy itself, never from the request.
 */
export const privySignInRequestSchema = z.object({
  accessToken: z.string().min(1).max(4096),
  transport: tokenTransportSchema.default("cookie"),
});
export type PrivySignInRequest = z.infer<typeof privySignInRequestSchema>;
export type PrivySignInRequestInput = z.input<typeof privySignInRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(200).optional(),
  transport: tokenTransportSchema.default("cookie"),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const linkWalletRequestSchema = signedMessageSchema.extend({
  connector: walletConnectorSchema.default("other"),
});
export type LinkWalletRequest = z.infer<typeof linkWalletRequestSchema>;

export const accessTokenClaimsSchema = z.object({
  sub: uuidSchema,
  wal: addressSchema,
  sid: uuidSchema,
  roles: z.array(roleSchema),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

export const meResponseSchema = z.object({
  profile: profileViewSchema,
  wallets: z.array(walletViewSchema),
  /** The account's address: prizes, joining and hosting all use it. */
  wallet: addressSchema,
  roles: z.array(roleSchema),
  /** How this session signed in, and the name the provider shows, for "Signed in as …". */
  login: z.object({ method: loginMethodSchema, handle: z.string().nullable() }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  /** Only present when the request asked for `transport: "body"`. */
  refreshToken: z.string().optional(),
  refreshTokenExpiresAt: isoDateTimeSchema,
  me: meResponseSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const wsTicketResponseSchema = z.object({
  ticket: z.string(),
  expiresAt: isoDateTimeSchema,
});
export type WsTicketResponse = z.infer<typeof wsTicketResponseSchema>;

export const apiKeyScopeSchema = z.enum(["scores:write", "sessions:read"]);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const createApiKeyRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(apiKeyScopeSchema)
    .min(1)
    .refine((s) => new Set(s).size === s.length, "Scopes must be unique"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

export const apiKeyViewSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  createdAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
});
export type ApiKeyView = z.infer<typeof apiKeyViewSchema>;

/** Returned once, at creation. The secret is never retrievable again. */
export const createdApiKeySchema = apiKeyViewSchema.extend({ secret: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const apiKeyIdentitySchema = z.object({
  keyId: uuidSchema,
  ownerId: uuidSchema,
  scopes: z.array(apiKeyScopeSchema),
});
export type ApiKeyIdentity = z.infer<typeof apiKeyIdentitySchema>;
