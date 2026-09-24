"use client"

import {
  useWeb3Auth,
  useWeb3AuthConnect,
  useWeb3AuthDisconnect,
  useWeb3AuthUser,
} from "@web3auth/modal/react"
import { useBalance, useConnection, useSwitchChain } from "wagmi"
import { formatUnits } from "viem"
import { LogOut } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import { Button } from "../ui/button"
import { Spinner } from "../ui/spinner"
import { useUserStore } from "@/store/user-store"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { baseChain } from "@/lib/wallet/wagmi"

// ─── Player Role Switcher ───────────────────────────────────
// Safe to use Web3Auth hooks here — only rendered inside Web3AuthProvider.

export function PlayerRoleSwitcher() {
  const { setRole } = useUserStore()
  const { disconnect, loading } = useWeb3AuthDisconnect()
  const router = useRouter()

  const switchToHost = async () => {
    await disconnect({ cleanup: true })
    setRole("host")
    router.replace("/organize")
  }

  return (
    <>
      <button
        disabled={loading}
        className="rounded-full px-3 py-1 transition-all bg-background text-primary shadow-sm"
      >
        Player
      </button>
      <button
        onClick={switchToHost}
        disabled={loading}
        className="rounded-full px-3 py-1 transition-all text-muted-foreground"
      >
        Host
      </button>
    </>
  )
}

// ─── Player Auth Button / Info ──────────────────────────────

export function PlayerAuth() {
  const { connect } = useWeb3AuthConnect()
  const { isConnected } = useWeb3Auth()
  const { userInfo } = useWeb3AuthUser()

  const onLogin = async () => {
    const provider = await connect()
    console.log({ provider })
  }

  if (userInfo && isConnected) {
    return <PlayerInformationPane />
  }

  return (
    <Button onClick={onLogin} className="rounded-full px-6">
      Login
    </Button>
  )
}

function PlayerInformationPane() {
  const { data: balance } = useBalance()
  const { userInfo } = useWeb3AuthUser()
  const { disconnect, loading } = useWeb3AuthDisconnect()

  const onLogout = async () => {
    await disconnect({ cleanup: true })
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-xs font-medium">{userInfo?.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatUnits(balance?.value || 0n, balance?.decimals || 18)} USD
        </p>
      </div>
      <Avatar className="h-8 w-8 border-2 border-primary">
        <AvatarImage src={userInfo?.profileImage} />
        <AvatarFallback>{userInfo?.name?.[0]}</AvatarFallback>
      </Avatar>
      <Button disabled={loading} variant="ghost" size="icon" onClick={onLogout}>
        {loading ? <Spinner /> : <LogOut size={18} />}
      </Button>
    </div>
  )
}
