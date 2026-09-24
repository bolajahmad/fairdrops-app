"use client"

import { baseChain } from "@/lib/wallet/wagmi"
import { useMemo } from "react"
import { erc20Abi, formatUnits, zeroAddress } from "viem"
import { useBalance, useReadContracts } from "wagmi"

export const useWalletBalances = (address?: `0x${string}`) => {
  const { data: nativeBalance } = useBalance({
    chainId: baseChain.id,
  })

  const { data } = useReadContracts({
    contracts: [
      {
        abi: erc20Abi,
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        functionName: "balanceOf",
        args: [address ?? zeroAddress],
      },
      {
        abi: erc20Abi,
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        functionName: "balanceOf",
        args: [address ?? zeroAddress],
      },
    ],
    query: {
      enabled: !!address,
    },
  })

  const balance = useMemo(() => {
    if (!nativeBalance) return "0"
    return formatUnits(nativeBalance.value, nativeBalance.decimals)
  }, [nativeBalance])
  const tokenBalances = useMemo(() => {
    if (!data) return []
    return data.map((d, index) => {
      if (!d.result) return undefined
      return {
        value: formatUnits(d.result, 6),
        address:
          index === 0
            ? "0xdAC17F958D2ee523a2206206994597C13D831ec7"
            : "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      }
    })
  }, [data])

  return {
    balance,
    tokenBalances,
  }
}
