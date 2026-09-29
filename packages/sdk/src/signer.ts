import type { Address, Hex } from "@fairdrops/shared";
import type { LocalAccount, WalletClient } from "viem";

export type TypedData = Parameters<LocalAccount["signTypedData"]>[0];

/**
 * Anything that can sign for one address. The SDK never sees private keys: pass a viem wallet
 * client (injected wallets, Web3Auth, WalletConnect all give one), a viem local account (scripts
 * and game servers), or your own implementation.
 */
export interface Signer {
  readonly address: Address;
  signMessage(message: string): Promise<Hex>;
  signTypedData(typedData: TypedData): Promise<Hex>;
}

export type SignerLike = Signer | LocalAccount | WalletClient;

function isWalletClient(source: SignerLike): source is WalletClient {
  return "transport" in source && "request" in source;
}

function isLocalAccount(source: SignerLike): source is LocalAccount {
  return "type" in source && source.type === "local";
}

export function toSigner(source: SignerLike): Signer {
  if (isWalletClient(source)) {
    const account = source.account;
    if (!account) throw new Error("The wallet client has no account; connect one first");
    return {
      address: account.address.toLowerCase() as Address,
      signMessage: (message) => source.signMessage({ account, message }),
      signTypedData: (typedData) => source.signTypedData({ account, ...typedData }),
    };
  }
  if (isLocalAccount(source)) {
    return {
      address: source.address.toLowerCase() as Address,
      signMessage: (message) => source.signMessage({ message }),
      signTypedData: (typedData) => source.signTypedData(typedData),
    };
  }
  return source;
}
