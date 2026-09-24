"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { IGiveaway, IHost, PlayerStatus } from "@/lib/models"
import { truncateString } from "@/lib/utils"
import { useMutation, useQuery } from "@tanstack/react-query"
import dayjs from "dayjs"
import { ChevronRight, Clock, Gamepad2, Trophy, Zap } from "lucide-react"
import relativeTime from "dayjs/plugin/relativeTime"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useWeb3AuthConnect, useWeb3AuthUser } from "@web3auth/modal/react"
import { useConnection } from "wagmi"
import { useRouter } from "next/navigation"
import { Spinner } from "@/components/ui/spinner"
import { useWalletBalances } from "@/hooks/use-wallet-balances"

dayjs.extend(relativeTime)

export const DisplayOngoingGames = () => {
  const { userInfo } = useWeb3AuthUser()
  const { connect, loading } = useWeb3AuthConnect()
  const { address } = useConnection()
  const router = useRouter()
  const { mutate, isPending } = useMutation({
    mutationFn: (gameId: string) =>
      fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/games/${gameId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address || "",
          displayName: userInfo?.name || userInfo?.email || "",
        }),
      }),
  })
  const { data, isLoading } = useQuery<IGiveaway[]>({
    queryKey: ["ongoing-games"],
    queryFn: async () =>
      fetch(`/api/giveaways?page=1&limit=20`).then((res) => res.json()),
    refetchInterval: 5000,
  })
  const giveaways = (data || [])
    .filter(
      ({ startTime, game }) =>
        startTime <= Math.round(new Date().getTime() / 1000) &&
        game?.status !== "completed" &&
        game?.status !== "cancelled"
    )
    .slice(0, 3)

  const joinGame = async (giveawayId: string, gameId: string) => {
    if (!userInfo) {
      await connect()
    }

    mutate(gameId, {
      onSuccess: (data) => {
        console.log({ response: data })
        router.push(`/games/${giveawayId}`)
      },
      onError: (err) => {
        console.error("Join game error", err)
        alert("Failed to join game. Please try again.")
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <Zap className="fill-primary text-primary" size={24} /> LIVE NOW
        </h2>
        <Button variant="ghost" size="sm" className="font-bold text-primary">
          See all
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <Card className="w-full max-w-xs">
            <CardHeader>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="aspect-video w-full" />
            </CardContent>
          </Card>
        ) : (
          giveaways.map(({ id, ...g }) => (
            <Card
              key={id}
              className="group cursor-pointer overflow-hidden transition-all hover:border-primary/50 active:scale-[0.98]"
            >
              <div className="relative flex h-32 items-center justify-center bg-muted">
                <div className="absolute inset-0 bg-linear-to-br from-primary/20 to-secondary/20 transition-opacity group-hover:opacity-100" />
                <Gamepad2
                  size={48}
                  className="text-primary/40 transition-transform group-hover:scale-110"
                />
                <div className="absolute top-2 right-2">
                  <Badge
                    variant="secondary"
                    className="bg-background/80 backdrop-blur-sm"
                  >
                    {g.game?.players?.filter(
                      ({ status }) => status === PlayerStatus.Online
                    ).length || 0}{" "}
                    playing
                  </Badge>
                </div>
              </div>
              <CardContent className="p-4">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <h3 className="text-lg leading-tight font-bold">
                      {g.metadata.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      by {truncateString(g.host)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-primary">
                      {Number(g.amount).toLocaleString()} {g.token.symbol}
                    </p>
                    <p className="text-[10px] font-bold tracking-widest uppercase opacity-50">
                      Prize Pool
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => joinGame(g.idParam, g.game?.id ?? "")}
                  className="mt-2 w-full transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                >
                  {loading || isPending ? <Spinner /> : null}
                  Join Now{" "}
                  {loading || isPending ? null : (
                    <ChevronRight size={16} className="ml-1" />
                  )}
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

export const DisplayUpcomingGames = () => {
  const { userInfo } = useWeb3AuthUser()
  const { address } = useConnection()
  const { balance } = useWalletBalances(address)
  const { connect, loading } = useWeb3AuthConnect()
  const router = useRouter()

  console.log({ balance });

  const { data, isLoading } = useQuery<IGiveaway[]>({
    queryKey: ["upcoming-games"],
    queryFn: async () =>
      fetch(`/api/giveaways?page=1&limit=20`).then((res) => res.json()),
    refetchInterval: 5000,
  })
  const giveaways = (data || [])
    .filter(
      ({ startTime }) =>
        startTime > Math.round(new Date().getTime() / 1000)
    )
    .slice(0, 3)
  const { mutate, isPending } = useMutation({
    mutationFn: (gameId: string) =>
      fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/games/${gameId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address || "",
          displayName: userInfo?.name || userInfo?.email || "",
        }),
      }),
  })

  const registerInterest = async (gameId: string, giveawayId: string) => {
    if (!userInfo) {
      await connect()
    }

    mutate(gameId, {
      onSuccess: (data) => {
        console.log({ response: data })
        router.push(`/games/${giveawayId}`)
      },
      onError: (err) => {
        console.error("Join game error", err)
        alert("Failed to join game. Please try again.")
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <Clock className="text-orange-500" size={24} /> STARTING SOON
        </h2>
      </div>
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex w-fit items-center gap-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="grid gap-2">
              <Skeleton className="h-4 w-37.5" />
              <Skeleton className="h-4 w-25" />
            </div>
          </div>
        ) : giveaways.length ? (
          giveaways.map((g) => (
            <div
              key={g.idParam}
              className="flex cursor-pointer items-center justify-between rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50"
              onClick={() =>
                isPending || loading
                  ? undefined
                  : registerInterest(g.game?.id ?? "", g.idParam)
              }
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-100 font-bold text-orange-600">
                  {g.metadata.title[0]}
                </div>
                <div>
                  <h4 className="font-bold">{g.metadata.title}</h4>
                  <p className="text-xs text-muted-foreground">
                    {g.game?.players?.length || 0} interested
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-primary">
                  {g.amount} {g.token.symbol}
                </p>
                <Badge
                  variant="outline"
                  className="border-orange-200 text-[10px] text-orange-600"
                >
                  Starts in {dayjs(g.startTime * 1000).fromNow()}
                </Badge>
              </div>
            </div>
          ))
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No Upcoming Giveaway</EmptyTitle>
              <EmptyDescription>
                There are no giveaways scheduled. Check back later!
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}

export const DisplayHostLeaderboardSample = () => {
  const { data, isLoading } = useQuery<IHost[]>({
    queryKey: ["get-all-hosts"],
    queryFn: async () =>
      fetch(`/api/hosts?page=1&limit=3`).then((res) => res.json()),
  })
  const hosts = data || []

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 px-2 text-2xl font-black tracking-tight">
        <Trophy className="text-yellow-500" size={24} /> TOP HOSTS
      </h2>
      <div className="grid grid-cols-3 gap-4">
        {hosts.map((host, i) => (
          <Card key={i} className="p-4 text-center">
            <Avatar className="mx-auto mb-2 h-12 w-12 border-2 border-primary/20">
              <AvatarImage
                src={
                  host.avatar
                    ? `data:image/png;base64,${host.avatar}`
                    : `https://api.dicebear.com/7.x/avataaars/svg?seed=${host.host}`
                }
              />
              <AvatarFallback className="text-2xl font-black">
                {host.username?.[0]}
              </AvatarFallback>
            </Avatar>
            <h4 className="truncate text-sm font-bold">{host.username}</h4>
            <p className="text-[10px] text-muted-foreground">
              {host.totalGiveaways} Games
            </p>
            <p className="mt-1 text-xs font-black text-primary">
              {host.totalPrize}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}
