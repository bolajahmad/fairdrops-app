"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getConfig } from "../wallet/wagmi"
import { WagmiProvider } from "wagmi"

const queryClient = new QueryClient()

export default function HostWeb3Provider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WagmiProvider config={getConfig()}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
