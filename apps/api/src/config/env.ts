import { deploymentEnvironmentSchema } from "@fairdrops/shared";
import { z } from "zod";

const envSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_VERSION: z.string().min(1).default("0.0.0"),
  DEPLOYMENT_ENVIRONMENT: deploymentEnvironmentSchema.default("testnet"),
});

export type ApiEnv = z.infer<typeof envSchema>;

export const API_ENV = Symbol("API_ENV");

export function parseApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid API environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
