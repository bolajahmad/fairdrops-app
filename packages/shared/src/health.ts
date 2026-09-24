import { z } from "zod";

export const serviceNameSchema = z.enum(["api", "worker"]);
export type ServiceName = z.infer<typeof serviceNameSchema>;

export const healthResponseSchema = z.object({
  service: serviceNameSchema,
  status: z.literal("ok"),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
