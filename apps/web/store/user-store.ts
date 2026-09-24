"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

type UserState = {
  role: "player" | "host"
  setRole: (role: "player" | "host") => void
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      role: "player",

      setRole: (role) =>
        set(() => ({
          role,
        })),
    }),
    {
      name: "USER_ROLE_CONFIG", // key in localStorage
    }
  )
)