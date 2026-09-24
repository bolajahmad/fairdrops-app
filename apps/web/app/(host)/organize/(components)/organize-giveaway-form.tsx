"use client"

import { Controller, useForm, UseFormReturn } from "react-hook-form"
import * as z from "zod"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronUp, ChevronDown, Clock, Zap, Brain, Dice5 } from "lucide-react"
import { Fragment, useState } from "react"
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { GiveawayFormValues } from "@/lib/schemas/giveaway"
import dayjs from "dayjs"
import { Checkbox } from "@/components/ui/checkbox"
import { TOKENS } from "@/lib/mocks"
import { useConnection } from "wagmi"
import { useWalletBalances } from "@/hooks/use-wallet-balances"
import { zeroAddress } from "viem"

export const GAME_STYLES = [
  {
    id: "quick",
    name: "Quick Fire",
    desc: "Fast & Furious",
    icon: Zap,
    color: "text-yellow-500",
  },
  {
    id: "skill",
    name: "Skill Test",
    desc: "Brain Power",
    icon: Brain,
    color: "text-blue-500",
  },
  {
    id: "luck",
    name: "Pure Luck",
    desc: "Dice Roll",
    icon: Dice5,
    color: "text-purple-500",
  },
]

type Props = {
  form: UseFormReturn<GiveawayFormValues>
}

export const OrganizeGiveawayForm = ({ form }: Props) => {
  const { address } = useConnection()
  const [when, setWhen] = useState<"now" | "schedule">("schedule")
  const { balance, tokenBalances } = useWalletBalances(address)

  const onSubmit = (values: GiveawayFormValues) => {
    console.log(values)
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {/* Prize & Winners */}
      <div className="">
        <FieldGroup>
          <Controller
            name="title"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="space-y-2">
                <FieldLabel className="flex items-center gap-2 text-sm font-bold">
                  📇 Giveaway Title
                </FieldLabel>
                <Input
                  placeholder="Enter title"
                  {...field}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="h-14 rounded-2xl border-2 text-lg font-bold"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="token"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="space-y-2">
                <div className="flex items-end justify-between">
                  <FieldLabel className="flex items-center gap-2 text-sm font-bold">
                    🪙 Select Token
                  </FieldLabel>
                  <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                    Balance:{" "}
                    <span className="text-foreground">
                      {Number(Number(field.value === zeroAddress
                        ? balance
                        : tokenBalances.find((t) => t?.address === field.value)
                            ?.value || 0).toFixed(2)).toLocaleString()}{" "}
                      {TOKENS.find((t) => t.address === field.value)?.symbol}
                    </span>
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {TOKENS.map((token) => (
                    <button
                      key={token.address}
                      type="button"
                      onClick={() => field.onChange(token.address)}
                      className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 font-bold transition-all ${
                        field.value === token.address
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border bg-card hover:border-primary/50"
                      }`}
                    >
                      {token.symbol}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          />

          <div className="flex items-start gap-4">
            <Controller
              control={form.control}
              name="prizePool"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="space-y-2">
                  <FieldLabel className="flex items-center gap-2 text-sm font-bold">
                    💰 Prize Pool
                  </FieldLabel>
                  <Input
                    type="number"
                    placeholder="5"
                    {...field}
                    onChange={(e) =>
                      field.onChange(Number(e.target.value) || 0)
                    }
                    className="h-14 rounded-2xl border-2 text-lg font-bold"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="numWinners"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="space-y-2">
                  <FieldLabel className="flex items-center gap-2 text-sm font-bold">
                    👥 Winners
                  </FieldLabel>
                  <Input
                    type="number"
                    placeholder="5"
                    {...field}
                    onChange={(e) =>
                      field.onChange(parseInt(e.target.value) || 0)
                    }
                    className="h-14 rounded-2xl border-2 text-lg font-bold"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>

          <Controller
            control={form.control}
            name="gameStyle"
            render={({ field }) => (
              <Field className="space-y-3">
                <label className="flex items-center justify-between gap-2 text-sm font-bold">
                  🎮 Game Style
                  <div className="flex items-center gap-2 font-medium">
                    <FieldLabel
                      htmlFor="terms-checkbox-2"
                      className="hidden lg:inline-block"
                    >
                      All
                    </FieldLabel>
                    <Checkbox
                      id="terms-checkbox-2"
                      name="terms-checkbox-2"
                      onCheckedChange={() => field.onChange([])}
                      checked={field.value.length === 0}
                      disabled={field.value.length === 0}
                    />
                  </div>
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {GAME_STYLES.map((style) => {
                    const handleChange = () => {
                      const value = field.value.find((s) => s === style.id)
                      field.onChange(
                        value
                          ? field.value.filter((s) => s !== style.id)
                          : field.value.length == 2
                            ? []
                            : [...field.value, style.id]
                      )
                    }

                    const isSelected =
                      field.value.includes(
                        style.id as GiveawayFormValues["gameStyle"][0]
                      ) || field.value.length === 0
                    return (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => handleChange()}
                        className={`group rounded-2xl border-2 p-4 text-left transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5 ring-4 ring-primary/10"
                            : "border-border bg-card hover:border-primary/50"
                        }`}
                      >
                        <style.icon
                          className={`mb-2 ${style.color} transition-transform group-hover:scale-110`}
                          size={24}
                        />
                        <p className="text-sm font-black">{style.name}</p>
                        <p className="text-[10px] font-medium text-muted-foreground">
                          {style.desc}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </Field>
            )}
          />

          <div>
            <Controller
              control={form.control}
              name="startTime"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="space-y-3">
                  <FieldLabel className="flex items-center gap-2 text-sm font-bold">
                    ⏱ Start Time
                  </FieldLabel>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        field.onChange(
                          dayjs().add(1, "minute").format("YYYY-MM-DDTHH:mm")
                        )
                        setWhen("now")
                      }}
                      className={`h-12 flex-1 rounded-xl border-2 font-bold transition-all ${
                        when === "now"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      Start Now
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWhen("schedule")
                        field.onChange(
                          dayjs().add(1, "minute").format("YYYY-MM-DDTHH:mm")
                        )
                      }}
                      className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border-2 font-bold transition-all ${
                        when === "schedule"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <Clock size={18} /> Schedule
                    </button>
                  </div>
                  <AnimatePresence>
                    {when === "schedule" && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <Input
                          type="datetime-local"
                          {...field}
                          className="h-12 rounded-xl border-2"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>
        </FieldGroup>
      </div>

      {/* Advanced Settings */}
      <Disclosure as="div" className="w-full max-w-md">
        {({ open }) => (
          <>
            <DisclosureButton className="flex items-center gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground">
              {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              Advanced Settings
            </DisclosureButton>
            <div className="overflow-hidden py-2">
              <AnimatePresence>
                {open && (
                  <DisclosurePanel static as={Fragment}>
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="space-y-4 overflow-hidden pt-4"
                    >
                      <Controller
                        control={form.control}
                        name="requireSocial"
                        render={({ field }) => (
                          <Field>
                            <div>
                              <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-4">
                                <div>
                                  <p className="text-sm font-bold">
                                    Require Social Follow
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Users must follow your Twitter to join
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => field.onChange(!field.value)}
                                  className={`relative h-6 w-12 rounded-full transition-colors ${
                                    field.value
                                      ? "bg-primary"
                                      : "bg-muted-foreground/30"
                                  }`}
                                >
                                  <motion.div
                                    animate={{ x: field.value ? 24 : 4 }}
                                    className="absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm"
                                  />
                                </button>
                              </div>
                            </div>
                          </Field>
                        )}
                      />
                      <Controller
                        control={form.control}
                        name="customRules"
                        render={({ field }) => (
                          <Field className="space-y-2">
                            <FieldLabel className="text-xs font-bold uppercase opacity-50">
                              Custom Rules
                            </FieldLabel>
                            <div>
                              <Textarea
                                placeholder="Add any specific rules or terms..."
                                {...field}
                                className="min-h-20 rounded-xl border-2 text-sm"
                              />
                            </div>
                          </Field>
                        )}
                      />
                    </motion.div>
                  </DisclosurePanel>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </Disclosure>
    </form>
  )
}
