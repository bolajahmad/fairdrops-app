import { zeroAddress } from "viem"
import * as z from "zod"

export const giveawaySchema = z.object({
  title: z.string().min(1, "Title is required"),
  prizePool: z.number().min(1, "Prize pool must be at least 1 USDT"),
  numWinners: z.number().min(1, "Must have at least 1 winner"),
  gameStyle: z
    .enum(["quick", "skill", "luck"])
    .array()
    .max(2)
    .refine(
      (val) => new Set(val).size === val.length,
      "Game styles must be unique"
    ),
  startTime: z.string().refine((val) => {
    if (!val) return true
    return new Date(val) > new Date()
  }, "Start time cannot be in the past"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  requireSocial: z.boolean(),
  customRules: z.string().optional(),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address").optional(),
})

export type GiveawayFormValues = z.infer<typeof giveawaySchema>
