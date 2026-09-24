import * as z from "zod"

export const hostProfileSchema = z.object({
  avatar: z
    .string()
    .optional(),
  username: z
    .string()
    .regex(/^[a-zA-Z]+$/, "Username must contain only letters")
    .optional()
    .or(z.literal("")),
  twitter: z
    .string()
    .url("Invalid Twitter profile URL")
    .optional()
    .or(z.literal("")),
  ig: z
    .string()
    .url("Invalid Instagram profile URL")
    .optional()
    .or(z.literal("")),
  bio: z
    .string()
    .max(30, "Bio must not exceed 30 characters")
    .optional()
    .or(z.literal("")),
})

export type HostProfileFormValues = z.infer<typeof hostProfileSchema>
