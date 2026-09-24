"use client"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useWalletBalances } from "@/hooks/use-wallet-balances"
import { IPlayer } from "@/lib/models"
import { serverUrl } from "@/lib/utils"
import { baseChain } from "@/lib/wallet/wagmi"
import { fetchPlayerByWallet } from "@/service/player.service"
import { useQuery } from "@tanstack/react-query"
import { useWeb3Auth, useWeb3AuthUser } from "@web3auth/modal/react"
import { useMemo } from "react"
import { Fragment } from "react/jsx-runtime"
import { formatUnits } from "viem"
import { monadTestnet } from "viem/chains"
import { useBalance, useConnection, useSwitchChain } from "wagmi"

export const UserWalletHeader = () => {
  const { address } = useConnection()
  const { data: balanceData } = useBalance({
    address,
  })
  const { data: player, isLoading } = useQuery<IPlayer>({
    queryKey: ["player-info", address],
    queryFn: async () => fetch(`${serverUrl}/api/players/${address?.toLowerCase()}`).then((res) => res.json()),
    enabled: !!address,
  })

  console.log({ balanceData, player, address })
  
  return (
    <Fragment>
      <Card className="relative overflow-hidden border-none bg-primary text-primary-foreground">
        <div className="absolute right-0 bottom-0 -mr-8 -mb-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <CardHeader className="flex items-start justify-between">
          <div className="space-y-4">
            <CardDescription className="text-md font-bold tracking-widest text-primary-foreground/70 uppercase">
              Available Balance
            </CardDescription>
            <CardTitle className="text-5xl font-black tracking-tighter">
              {formatUnits(
                balanceData?.value || 0n,
                balanceData?.decimals || 18
              )}{" "}
              MON
            </CardTitle>
          </div>

          <CardContent className="ml-auto space-y-4">
            <div className="flex gap-2">
              <Button className="bg-white font-bold text-primary hover:bg-white/90">
                Withdraw
              </Button>
            </div>
          </CardContent>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card className="space-y-1 p-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase">
            Total Won
          </p>
          <p className="text-xl font-black">1,250 MON</p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase">
            Games Played
          </p>
          <p className="text-xl font-black">{player?.games.length || 0}</p>
        </Card>
      </div>
    </Fragment>
  )
}
