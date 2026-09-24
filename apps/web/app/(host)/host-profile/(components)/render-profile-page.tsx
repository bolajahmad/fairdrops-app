"use client"

import { useUserStore } from "@/store/user-store"
import { RenderHostProfilePage } from "./host-profile"

export const RenderProfilePage = () => {
    const { role } = useUserStore()
    return role === "host" ? (
        <RenderHostProfilePage />
    ) : (
        <h2>
            User Profile
        </h2>
    )
}