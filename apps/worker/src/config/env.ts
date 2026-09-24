import { z } from "zod";

const envSchema = z.object({
  APP_VERSION: z.string().min(1).default("0.0.0"),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export const WORKER_ENV = Symbol("WORKER_ENV");

export function parseWorkerEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid worker environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
