import { addressSchema, deploymentEnvironmentSchema } from "@fairdrops/shared";
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const commaList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const originList = commaList.pipe(
  z.array(z.url().transform((value) => new URL(value).origin)).min(1, "At least one origin"),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    APP_VERSION: z.string().min(1).default("0.0.0"),
    DEPLOYMENT_ENVIRONMENT: deploymentEnvironmentSchema.default("testnet"),

    DATABASE_URL: z.url(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.url().default("redis://localhost:6379"),

    /** First-party web origins: allowed to use cookies, and to request sign-in messages. */
    APP_ORIGINS: originList.default(["http://localhost:3000"]),
    /** Express `trust proxy` setting, so rate limits see the client address behind a proxy. */
    TRUST_PROXY: z.string().default("loopback"),

    /** ES256 private key as a JWK with a `kid`. Generated per process when unset, outside production. */
    AUTH_JWT_PRIVATE_JWK: z.string().optional(),
    AUTH_ISSUER: z.string().min(1).default("fairdrops"),
    AUTH_AUDIENCE: z.string().min(1).default("fairdrops-api"),
    AUTH_COOKIE_SECURE: booleanString.optional(),

    /**
     * Extra admins for local development only. Everywhere else, admin rights come from
     * holding DEFAULT_ADMIN_ROLE on the deployed FairDrops contracts.
     */
    LOCAL_ADMIN_ADDRESSES: commaList.pipe(z.array(addressSchema)),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.AUTH_JWT_PRIVATE_JWK) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_JWT_PRIVATE_JWK"],
        message: "Required in production, so tokens survive restarts and work across instances",
      });
    }
    if (env.LOCAL_ADMIN_ADDRESSES.length > 0 && env.DEPLOYMENT_ENVIRONMENT !== "local") {
      ctx.addIssue({
        code: "custom",
        path: ["LOCAL_ADMIN_ADDRESSES"],
        message: "Only allowed when DEPLOYMENT_ENVIRONMENT is local; use the contract admin role",
      });
    }
  })
  .transform((env) => ({
    ...env,
    AUTH_COOKIE_SECURE: env.AUTH_COOKIE_SECURE ?? env.NODE_ENV === "production",
  }));

export type ApiEnv = z.infer<typeof envSchema>;

export const API_ENV = Symbol("API_ENV");

export function parseApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  // `KEY=` in a .env file means "not set", not "set to an empty string".
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = envSchema.safeParse(defined);
  if (!result.success) {
    throw new Error(`Invalid API environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
