"use client"

import { Button } from "@/components/ui/button"
import { Eye, EyeOff, Zap } from "lucide-react"
import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import { Separator } from "@/components/ui/separator"
import { OrganizeGiveawayForm } from "./(components)/organize-giveaway-form"
import { GiveawayFormValues, giveawaySchema } from "@/lib/schemas/giveaway"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { SummaryCard } from "./(components)/created-giveaway-summary"
import dayjs from "dayjs"
import { useWriteContract } from "wagmi"
import {
  GiveawayContractABI,
  GiveawayContractAddress,
} from "@/lib/contracts/giveaway"
import { parseUnits, stringToHex, zeroAddress } from "viem"
import { Spinner } from "@/components/ui/spinner"

export default function CreateGiveawayPage() {
  const form = useForm<GiveawayFormValues>({
    resolver: zodResolver(giveawaySchema),
    defaultValues: {
      title: "",
      prizePool: 1,
      numWinners: 0,
      gameStyle: [],
      startTime: dayjs().add(1, "minute").format("YYYY-MM-DDTHH:mm"),
      description: "",
      requireSocial: false,
      customRules: "",
      token: zeroAddress,
    },
  })
  const control = form.control
  const [prizePool] = useWatch({
    control,
    name: ["prizePool"],
  })

  const { mutate: writeLaunchGiveaway, isPending: launching } =
    useWriteContract({
      mutation: {
        onError: (error) => {
          console.log({ error })
        },
        onSuccess: async () => {
          setShowMobileSummary(false)
          setShowConfirm(true)
          toast.success("Giveaway launched successfully!")
          form.reset()
        },
      },
    })
  const launchGiveaway = () => {
    const amount = parseUnits(prizePool.toString(), 18)
    const token = zeroAddress
    const startTime = new Date(form.getValues("startTime")).getTime() / 1000
    const winners = form.getValues("numWinners")
    const metadata = JSON.stringify({
      version: "0.1.0",
      title: form.getValues("title"),
      description: form.getValues("description"),
      gameStyle: form.getValues("gameStyle"),
      requireSocial: form.getValues("requireSocial"),
      customRules: form.getValues("customRules"),
    })

    writeLaunchGiveaway({
      abi: GiveawayContractABI,
      address: GiveawayContractAddress,
      functionName: "createGiveaway",
      args: [amount, token, BigInt(startTime), winners, stringToHex(metadata)],
      value: token === zeroAddress ? amount : undefined,
    })
  }

  const [showConfirm, setShowConfirm] = useState(false)
  const [showMobileSummary, setShowMobileSummary] = useState(false)

  return (
    <div className="mx-auto max-w-4xl px-6 pt-20 pb-60 md:pb-32 lg:pb-0">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Form Section */}
        <div className="space-y-8 lg:col-span-7">
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tighter">
              LAUNCH A GIVEAWAY
            </h1>
            <p className="font-medium text-muted-foreground">
              Fast, fun, and fair rewards for your community.
            </p>
          </div>

          <div>
            <OrganizeGiveawayForm form={form} />
          </div>
        </div>

        {/* Desktop Preview Section */}
        <div className="hidden lg:col-span-5 lg:block">
          <div className="sticky top-24 space-y-6">
            <div className="space-y-2">
              <h3 className="text-xs font-black tracking-widest text-muted-foreground uppercase">
                Live Preview
              </h3>
              <SummaryCard control={control} />
            </div>

            <Button
              onClick={() => setShowConfirm(true)}
              className="group h-20 w-full rounded-[2rem] text-2xl font-black tracking-tight shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Launch Giveaway 🚀
            </Button>

            <p className="text-center text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              Securely powered by Monad Network
            </p>
          </div>
        </div>
      </div>

      {/* Mobile Persistent CTA & Summary Toggle */}
      <div className="fixed right-0 bottom-20 left-0 z-40 flex flex-col gap-3 border-t border-border bg-background/80 p-4 backdrop-blur-xl lg:hidden">
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => setShowMobileSummary(true)}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-2 font-bold"
          >
            <Eye size={18} /> View Summary
          </Button>
          <Button
            onClick={() => setShowConfirm(true)}
            className="h-14 flex-2 rounded-2xl text-lg font-black shadow-lg shadow-primary/20"
          >
            Launch 🚀
          </Button>
        </div>
      </div>

      {/* Mobile Summary Modal */}
      <AnimatePresence>
        {showMobileSummary && (
          <div className="fixed inset-0 z-100 flex items-end justify-center p-0 sm:items-center sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileSummary(false)}
              className="absolute inset-0 bg-background/90 backdrop-blur-md"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="relative max-h-[90vh] w-full max-w-lg space-y-6 overflow-y-auto rounded-t-[2.5rem] border-t-2 border-border bg-card p-6 shadow-2xl sm:rounded-[2.5rem] sm:border-2"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black tracking-tight">
                  GIVEAWAY PREVIEW
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowMobileSummary(false)}
                >
                  <EyeOff size={20} />
                </Button>
              </div>

              <SummaryCard control={control} isMobile />

              <Button
                onClick={() => launchGiveaway()}
                className="h-16 w-full rounded-2xl text-xl font-black"
              >
                Looks Good, Launch! 🚀
              </Button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirm && (
          <div className="fixed inset-0 z-110 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirm(false)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md space-y-6 rounded-[2.5rem] border-2 border-border bg-card p-8 shadow-2xl"
            >
              <div className="space-y-2 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Zap size={32} fill="currentColor" />
                </div>
                <h2 className="text-2xl font-black tracking-tighter">
                  Ready to Launch?
                </h2>
                <p className="font-medium text-muted-foreground">
                  You&apos;re about to deposit{" "}
                  <span className="font-bold text-foreground">
                    {prizePool} USDT
                  </span>{" "}
                  to start this giveaway.
                </p>
              </div>

              <div className="space-y-3 rounded-2xl bg-muted p-4">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-muted-foreground">
                    Prize Pool
                  </span>
                  <span className="font-bold">{prizePool} USDT</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-muted-foreground">
                    Network Fee
                  </span>
                  <span className="font-bold">~0.01 MON</span>
                </div>
                <Separator />
                <div className="flex justify-between font-black">
                  <span>Total</span>
                  <span className="text-primary">{prizePool} USDT</span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="h-14 flex-1 rounded-2xl font-bold"
                  onClick={() => setShowConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="h-14 flex-1 rounded-2xl text-lg font-black"
                  disabled={launching || form.formState.isValid}
                  onClick={() => launchGiveaway()}
                >
                  {launching ? <Spinner /> : null}
                  Confirm 🚀
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
