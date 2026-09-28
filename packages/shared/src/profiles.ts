import { z } from "zod";
import { addressSchema, httpsUrlSchema, isoDateTimeSchema, uuidSchema } from "./primitives.js";

export const HANDLE_CHANGE_COOLDOWN_DAYS = 30;

const RESERVED_HANDLES = new Set([
  "admin",
  "administrator",
  "api",
  "fairdrops",
  "help",
  "me",
  "moderator",
  "official",
  "root",
  "support",
  "system",
]);

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Use 3 to 20 lowercase letters, numbers or underscores")
  .refine((value) => !RESERVED_HANDLES.has(value), "This handle is reserved");

export const socialPlatformSchema = z.enum([
  "x",
  "instagram",
  "tiktok",
  "youtube",
  "twitch",
  "discord",
  "telegram",
  "github",
  "website",
]);
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;

interface PlatformRule {
  pattern: RegExp;
  /** Hosts whose profile URLs may be pasted instead of a bare handle. */
  hosts: string[];
  url: ((handle: string) => string) | null;
}

const platformRules: Record<Exclude<SocialPlatform, "website">, PlatformRule> = {
  x: {
    pattern: /^[A-Za-z0-9_]{1,15}$/,
    hosts: ["x.com", "twitter.com"],
    url: (h) => `https://x.com/${h}`,
  },
  instagram: {
    pattern: /^[A-Za-z0-9._]{1,30}$/,
    hosts: ["instagram.com"],
    url: (h) => `https://instagram.com/${h}`,
  },
  tiktok: {
    pattern: /^[A-Za-z0-9._]{2,24}$/,
    hosts: ["tiktok.com"],
    url: (h) => `https://tiktok.com/@${h}`,
  },
  youtube: {
    pattern: /^[A-Za-z0-9._-]{3,30}$/,
    hosts: ["youtube.com"],
    url: (h) => `https://youtube.com/@${h}`,
  },
  twitch: {
    pattern: /^[A-Za-z0-9_]{4,25}$/,
    hosts: ["twitch.tv"],
    url: (h) => `https://twitch.tv/${h}`,
  },
  discord: { pattern: /^[a-z0-9._]{2,32}$/, hosts: [], url: null },
  telegram: {
    pattern: /^[A-Za-z0-9_]{5,32}$/,
    hosts: ["t.me", "telegram.me"],
    url: (h) => `https://t.me/${h}`,
  },
  github: {
    pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
    hosts: ["github.com"],
    url: (h) => `https://github.com/${h}`,
  },
};

/**
 * Accepts what people actually paste, "@name", "name" or a profile URL, and returns the bare
 * handle. Websites are returned unchanged. Returns null when the input cannot be a valid handle.
 */
export function normalizeSocialHandle(platform: SocialPlatform, input: string): string | null {
  const raw = input.trim();
  if (platform === "website") return httpsUrlSchema.safeParse(raw).success ? raw : null;

  const rule = platformRules[platform];
  let handle = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (!rule.hosts.includes(host)) return null;
      handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } catch {
      return null;
    }
  }
  handle = handle.replace(/^@/, "");
  return rule.pattern.test(handle) ? handle : null;
}

export function socialUrl(platform: SocialPlatform, handle: string): string | null {
  if (platform === "website") return handle;
  const build = platformRules[platform].url;
  return build ? build(handle) : null;
}

export const socialLinkInputSchema = z
  .object({ platform: socialPlatformSchema, handle: z.string().min(1).max(200) })
  .transform((link, ctx) => {
    const handle = normalizeSocialHandle(link.platform, link.handle);
    if (!handle) {
      ctx.addIssue({ code: "custom", message: `Not a valid ${link.platform} handle or URL` });
      return z.NEVER;
    }
    return { platform: link.platform, handle };
  });
export type SocialLinkInput = z.output<typeof socialLinkInputSchema>;

export const socialLinkViewSchema = z.object({
  platform: socialPlatformSchema,
  handle: z.string(),
  url: z.string().nullable(),
  /** Set once FairDrops has proven the account belongs to this user. Not yet implemented. */
  verifiedAt: isoDateTimeSchema.nullable(),
});
export type SocialLinkView = z.infer<typeof socialLinkViewSchema>;

export const walletConnectorSchema = z.enum(["web3auth", "injected", "walletconnect", "other"]);
export type WalletConnector = z.infer<typeof walletConnectorSchema>;

export const walletKindSchema = z.enum(["EOA", "CONTRACT"]);
export type WalletKind = z.infer<typeof walletKindSchema>;

export const walletViewSchema = z.object({
  address: addressSchema,
  kind: walletKindSchema,
  connector: walletConnectorSchema.nullable(),
  linkedAt: isoDateTimeSchema,
  lastSignInAt: isoDateTimeSchema.nullable(),
});
export type WalletView = z.infer<typeof walletViewSchema>;

/** A public profile. Wallet addresses are included because payouts are public on-chain anyway. */
export const profileViewSchema = z.object({
  id: uuidSchema,
  handle: z.string().nullable(),
  displayName: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  socials: z.array(socialLinkViewSchema),
  wallets: z.array(addressSchema),
  createdAt: isoDateTimeSchema,
});
export type ProfileView = z.infer<typeof profileViewSchema>;

export const updateProfileRequestSchema = z
  .object({
    handle: handleSchema.nullable(),
    displayName: z.string().trim().min(1).max(40).nullable(),
    bio: z.string().trim().max(160).nullable(),
    avatarUrl: httpsUrlSchema.nullable(),
    socials: z
      .array(socialLinkInputSchema)
      .max(socialPlatformSchema.options.length)
      .refine(
        (links) => new Set(links.map((l) => l.platform)).size === links.length,
        "Each platform may appear once",
      ),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateProfileRequest = z.output<typeof updateProfileRequestSchema>;

/** What to show for someone who has not chosen a name, e.g. "Player 3f9a". */
export function defaultDisplayName(address: string): string {
  return `Player ${address.slice(-4).toLowerCase()}`;
}
