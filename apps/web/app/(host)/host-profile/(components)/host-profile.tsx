"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  GiveawayContractABI,
  GiveawayContractAddress,
} from "@/lib/contracts/giveaway"
import { IHost } from "@/lib/models"
import { HostProfileFormValues, hostProfileSchema } from "@/lib/schemas/host"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { stringToHex } from "viem"
import { useConnection, useWriteContract } from "wagmi"

export const RenderHostProfilePage = () => {
  const { address } = useConnection()
  const { data: host, isLoading } = useQuery<IHost>({
    queryKey: ["hostById", address],
    queryFn: async () =>
      fetch(`/api/hosts/${address}`).then((res) => res.json()),
    enabled: !!address,
  })
  const form = useForm<HostProfileFormValues>({
    resolver: zodResolver(hostProfileSchema),
    defaultValues: {
      avatar: "",
      bio: "",
      username: "",
      twitter: "",
      ig: "",
    },
  })
  const { mutate: writeProfileUpdate } = useWriteContract({
    mutation: {
      onError: (error) => console.log({ error }),
      onSuccess: (data) => console.log({ data }),
    },
  })
  const [username] = useWatch({
    control: form.control,
    name: ["username"],
  })

  const onSubmit = (values: HostProfileFormValues) => {
    console.log({ values })
    const metadata = stringToHex(JSON.stringify(values))
    writeProfileUpdate({
      abi: GiveawayContractABI,
      address: GiveawayContractAddress,
      functionName: "updateHostProfile",
      args: [metadata],
    })
  }

  useEffect(() => {
    if (host) {
      form.reset({
        avatar: host.avatar || "",
        bio: host.bio || "",
        username: host.username || "",
        twitter: host.twitter || "",
        ig: host.ig || "",
      })
    }
  }, [host, form])

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <div className="mx-auto max-w-2xl space-y-8">
        <Controller
          name="avatar"
          control={form.control}
          render={({ field }) => (
            <div className="flex items-center gap-6">
              <div>
                <input
                  type="file"
                  id="avatar-upload"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      const reader = new FileReader()
                      reader.onloadend = () => {
                        const base64 =
                          reader.result?.toString().split(",")[1] || ""
                        field.onChange(base64)
                      }
                      reader.readAsDataURL(file)
                    }
                  }}
                  className="hidden"
                />
                <Avatar
                  className="h-24 w-24 cursor-pointer border-4 border-primary"
                  onClick={() =>
                    document.getElementById("avatar-upload")?.click()
                  }
                >
                  <AvatarImage
                    src={
                      field.value
                        ? `data:image/png;base64,${field.value}`
                        : `https://api.dicebear.com/7.x/avataaars/svg?seed=${address}`
                    }
                  />
                  <AvatarFallback className="text-2xl font-black">
                    {username?.[0]}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tighter">
                  {username}
                </h1>
                <p className="text-muted-foreground">
                  Verified Host since{" "}
                  {new Date(Number(host?.timestamp) * 1000).getFullYear()}
                </p>
              </div>
            </div>
          )}
        />

        <Card className="space-y-6 p-6">
          <div className="space-y-4">
            <Controller
              name="username"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="space-y-2">
                  <FieldLabel className="flex items-center gap-2 text-sm font-bold">
                    Display Name
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
              name="twitter"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="space-y-2">
                  <FieldLabel className="flex items-center gap-2 text-sm font-bold">
                    Twitter / X Link
                  </FieldLabel>
                  <Input
                    placeholder="https://x.com/username"
                    type="url"
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
              name="ig"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="space-y-2">
                  <FieldLabel className="flex items-center gap-2 text-sm font-bold">
                    Instagram Link
                  </FieldLabel>
                  <Input
                    placeholder="https://instagram.com/username"
                    type="url"
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
              name="bio"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="space-y-2">
                  <FieldLabel className="flex items-center gap-2 text-sm font-bold">
                    Bio
                  </FieldLabel>
                  <Input
                    placeholder="Enter bio"
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
          </div>

          <Button className="h-12 w-full font-bold">
            Save Profile Changes
          </Button>
        </Card>
      </div>
    </form>
  )
}
