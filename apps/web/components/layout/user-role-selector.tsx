"use client"

import { useUserStore } from "@/store/user-store"
import {
  Gamepad2,
  HomeIcon,
  LogOut,
  PlusCircle,
  TrendingUp,
  User,
  Wallet,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import { Button } from "../ui/button"
import {
  injected,
  useConnect,
  useConnection,
  useDisconnect,
} from "wagmi"
import { Spinner } from "../ui/spinner"
import { truncateString } from "@/lib/utils"
import { useState } from "react"

// ─── Dynamic imports for player components (Web3Auth) ────────
// These are lazy-loaded so the @web3auth/modal/react module is never
// evaluated in the (host) layout which only has a plain Wagmi provider.

const DynPlayerRoleSwitcher = dynamic(
  () => import("./player-navbar").then((m) => m.PlayerRoleSwitcher),
  { ssr: false }
)

const DynPlayerAuth = dynamic(
  () => import("./player-navbar").then((m) => m.PlayerAuth),
  { ssr: false }
)

// ─── Role Selector ───────────────────────────────────────────

export const NavbarRoleSelector = () => {
  const { role } = useUserStore()

  return (
    <div className="flex rounded-full bg-muted p-1 text-[10px] font-bold tracking-tighter uppercase">
      {role === "player" ? <DynPlayerRoleSwitcher /> : <HostRoleSwitcher />}
    </div>
  )
}

/** Mounted only inside plain Wagmi context (host role) */
function HostRoleSwitcher() {
  const { setRole } = useUserStore()
  const { connector } = useConnection()
  const { mutate: disconnectWallet, isPending: isDisconnecting } =
    useDisconnect()
  const router = useRouter()

  const switchToPlayer = () => {
    if (connector) {
      disconnectWallet({ connector })
    }
    setRole("player")
    router.replace("/")
  }

  return (
    <>
      <button
        onClick={switchToPlayer}
        disabled={isDisconnecting}
        className="rounded-full px-3 py-1 transition-all text-muted-foreground"
      >
        Player
      </button>
      <button
        disabled={isDisconnecting}
        className="rounded-full px-3 py-1 transition-all bg-background text-primary shadow-sm"
      >
        Host
      </button>
    </>
  )
}

// ─── Navigation Menu ─────────────────────────────────────────

export const DisplayNavbarNavigationMenu = () => {
  const { role } = useUserStore()
  const pathname = usePathname()

  return (
    <div className="flex flex-1 justify-around md:flex-none md:gap-8">
      {role === "player"
        ? [
            { id: "home", icon: HomeIcon, label: "Home", path: "/" },
            { id: "games", icon: Gamepad2, label: "Games", path: "/games" },
            { id: "wallet", icon: Wallet, label: "Wallet", path: "/wallet" },
            { id: "profile", icon: User, label: "Profile", path: "/profile" },
          ].map((item) => (
            <Link href={item.path} key={item.id}>
              <button
                className={`flex flex-col items-center gap-1 transition-colors md:flex-row md:gap-2 ${
                  pathname === item.path
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon size={20} />
                <span className="text-[10px] font-medium md:text-sm">
                  {item.label}
                </span>
              </button>
            </Link>
          ))
        : [
            {
              id: "host-dash",
              icon: TrendingUp,
              label: "Dashboard",
              path: "/dashboard",
            },
            {
              id: "host-create",
              icon: PlusCircle,
              label: "Organize",
              path: "/organize",
            },
            {
              id: "host-profile",
              icon: User,
              label: "Host Profile",
              path: "/host-profile",
            },
          ].map((item) => (
            <Link href={item.path} key={item.id}>
              <button
                className={`flex flex-col items-center gap-1 transition-colors md:flex-row md:gap-2 ${
                  pathname === item.path
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon size={20} />
                <span className="text-[10px] font-medium md:text-sm">
                  {item.label}
                </span>
              </button>
            </Link>
          ))}
    </div>
  )
}

// ─── Authentication ─────────────────────────────────────────

export const AuthenticateUser = () => {
  const { role } = useUserStore()

  return (
    <div className="hidden items-center gap-4 md:flex">
      {role === "player" ? <DynPlayerAuth /> : <HostAuthenticatedInformation />}
    </div>
  )
}

const HostAuthenticatedInformation = () => {
  const { isConnected, address, connector } = useConnection()
  const { mutate: connectWallet, isPending } = useConnect({
    mutation: {
      onError: error => console.log({ error })
    }
  })
  const { mutate: disconnectWallet, isPending: isDisconnecting } =
    useDisconnect()
  const [hostProfile] = useState({
    username: "MonadKing",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=MonadKing",
    twitter: "https://x.com/monadking",
    bio: "Building the most exciting giveaway arena on Monad. Join our community for daily rewards!",
  })

  const handleConnect = () => {
    connectWallet({ connector: injected() })
  }

  const handleDisconnect = () => {
    disconnectWallet({ connector })
  }

  return isConnected && address ? (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-xs font-bold">{hostProfile.username || "Host"}</p>
        <p className="text-[10px] text-muted-foreground">
          {truncateString(address)}
        </p>
      </div>
      <Avatar className="h-8 w-8 border-2 border-primary">
        <AvatarImage
          src={
            hostProfile.avatar ||
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${address}`
          }
        />
        <AvatarFallback>{(hostProfile.username || "H")[0]}</AvatarFallback>
      </Avatar>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => handleDisconnect()}
        disabled={isDisconnecting}
      >
        <LogOut size={18} />
      </Button>
    </div>
  ) : (
    <Button
      variant="outline"
      className="rounded-full border-primary text-primary hover:bg-primary/10"
      onClick={handleConnect}
    >
      {isPending ? <Spinner /> : <Wallet size={16} className="mr-2" />} Connect
      Wallet
    </Button>
  )
}
