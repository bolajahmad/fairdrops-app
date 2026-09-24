import { QueryClient } from "@tanstack/react-query"
import {
  cookieStorage,
  createConfig,
  createStorage,
  fallback,
  http,
  injected,
  webSocket,
} from "wagmi"

export const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  network: "Monad Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: [
        "https://testnet-rpc.monad.xyz",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: "https://testnet.monadscan.com/",
    },
  },
} as const

export const monad = {
  id: 143,
  name: "Monad Mainnet",
  network: "Monad Mainnet",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.monad.xyz/"],
    },
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: "https://monadscan.com",
    },
  },
} as const

export function getConfig() {
  return createConfig({
    chains: [monadTestnet, monad],
    storage: createStorage({
      storage: cookieStorage,
    }),
    ssr: true,
    connectors: [injected()],
    transports: {
      [monadTestnet.id]: http(),
      [monad.id]: http(),
    },
  })
}

export const baseChain = process.env.NEXT_PUBLIC_BASE_CHAIN_ENV === "testnet" ? monadTestnet : monad
export const defaultRpc = process.env.NEXT_PUBLIC_BASE_CHAIN_ENV === "testnet" ? monadTestnet.rpcUrls.default.http[0] : monad.rpcUrls.default.http[0]

declare module "wagmi" {
  interface Register {
    config: ReturnType<typeof getConfig>
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retryOnMount: true,
      staleTime: 2 * 1000 * 60, // 2 minute
    },
  },
})
