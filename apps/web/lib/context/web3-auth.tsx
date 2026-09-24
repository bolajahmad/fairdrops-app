"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  AUTH_CONNECTION,
  WALLET_CONNECTORS,
  WEB3AUTH_NETWORK,
} from "@web3auth/modal"
import {
  Web3AuthProvider,
  type Web3AuthContextConfig,
} from "@web3auth/modal/react"
import { WagmiProvider } from "@web3auth/modal/react/wagmi"

const web3AuthClientID = process.env.NEXT_PUBLIC_WEB3AUTH_ID || ""

export const web3AuthContextConfig: Web3AuthContextConfig = {
  web3AuthOptions: {
    clientId: web3AuthClientID, // Pass your Web3Auth Client ID, ideally using an environment variable
    web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
    modalConfig: {
      connectors: {
        [WALLET_CONNECTORS.AUTH]: {
          label: "auth",
          loginMethods: {
            email_passwordless: {
              name: "email passwordless login",
              authConnectionId: "dashmeabeg",
            },
            sms_passwordless: {
              name: "SMS Passwordless",
              authConnection: AUTH_CONNECTION.SMS_PASSWORDLESS,
              authConnectionId: "dashmeabeg-sms", // Replace with your custom SMS OTP Auth Connection ID
            },
          },
        },
      },
    }
  },
}

const queryClient = new QueryClient()

export default function RootProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Web3AuthProvider config={web3AuthContextConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider>{children}</WagmiProvider>
      </QueryClientProvider>
    </Web3AuthProvider>
  )
}
