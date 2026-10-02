import { Injectable } from "@nestjs/common";
import { erc20Abi, type Address } from "viem";
import { ChainClients } from "../infra/chain-clients.service.js";

export const TOKEN_READER = Symbol("TOKEN_READER");

export interface Erc20Metadata {
  symbol: string;
  name: string;
  decimals: number;
}

/** Reads an ERC-20's metadata from its contract. Null when the address is not an ERC-20. */
export interface TokenReader {
  read(chainId: number, address: Address): Promise<Erc20Metadata | null>;
}

/**
 * Three view calls in parallel (registry chains define no Multicall3, so no batching). A missing
 * `name` is tolerated; a missing symbol or decimals means the address is not an ERC-20.
 */
@Injectable()
export class ChainTokenReader implements TokenReader {
  constructor(private readonly clients: ChainClients) {}

  async read(chainId: number, address: Address): Promise<Erc20Metadata | null> {
    const client = this.clients.get(chainId);
    const call = <T>(functionName: "symbol" | "name" | "decimals") =>
      client.readContract({ address, abi: erc20Abi, functionName }) as Promise<T>;
    const [symbol, name, decimals] = await Promise.allSettled([
      call<string>("symbol"),
      call<string>("name"),
      call<number>("decimals"),
    ]);
    if (symbol.status !== "fulfilled" || decimals.status !== "fulfilled") return null;
    const cleanSymbol = clean(symbol.value, 32);
    if (!cleanSymbol) return null;
    return {
      symbol: cleanSymbol,
      name: (name.status === "fulfilled" ? clean(name.value, 64) : null) ?? cleanSymbol,
      decimals: Number(decimals.value),
    };
  }
}

/** Trims, drops control characters and caps the length; contracts can return anything. */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text ? text.slice(0, max) : null;
}
