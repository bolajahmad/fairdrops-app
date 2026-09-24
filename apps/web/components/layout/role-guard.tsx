"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useUserStore } from "@/store/user-store"

/**
 * Redirects users to the correct route group when their role
 * doesn't match the layout they're currently in.
 *
 * Drop into each layout:
 *   <RoleGuard expected="player" />   — inside (home) & games layouts
 *   <RoleGuard expected="host" />     — inside (host) layout
 */
export function RoleGuard({ expected }: { expected: "player" | "host" }) {
  const role = useUserStore((s) => s.role)
  const router = useRouter()

  useEffect(() => {
    if (role !== expected) {
      router.replace(role === "host" ? "/organize" : "/")
    }
  }, [role, expected, router])

  return null
}
