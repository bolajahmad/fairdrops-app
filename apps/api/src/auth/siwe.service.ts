import { Injectable } from "@nestjs/common";
import { AUTH_LIFETIMES, findChain, type Address, type WalletKind } from "@fairdrops/shared";
import { recoverMessageAddress, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { AppException } from "../common/app.exception.js";
import { ChainClients } from "../infra/chain-clients.service.js";
import { AllowedOriginsService } from "./allowed-origins.service.js";
import { AuthStore } from "./auth.store.js";

const CLOCK_SKEW_MS = 60_000;

export interface VerifiedWallet {
  address: Address;
  kind: WalletKind;
  chainId: number;
}

/**
 * Verifies EIP-4361 (Sign-In with Ethereum) messages. The server never trusts an address the
 * client states: it only accepts one recovered from, or verified against, a signature over a
 * fresh single-use nonce.
 */
@Injectable()
export class SiweService {
  constructor(
    private readonly store: AuthStore,
    private readonly origins: AllowedOriginsService,
    private readonly chains: ChainClients,
  ) {}

  async verify(
    message: string,
    signature: Hex,
    expectedStatement: string,
  ): Promise<VerifiedWallet> {
    const fields = parseSiweMessage(message);
    const { address, chainId, domain, uri, nonce, issuedAt } = fields;
    if (!address || !chainId || !domain || !uri || !nonce || !issuedAt || fields.version !== "1") {
      throw invalid("The message is not a complete sign-in message");
    }
    if (fields.statement !== expectedStatement)
      throw invalid("The message statement is not recognized");
    await this.checkOrigin(domain, uri);
    this.checkTimes(issuedAt, fields.expirationTime, fields.notBefore);
    if (!findChain(chainId)) throw invalid(`Chain ${chainId} is not supported`);

    const normalized = address.toLowerCase() as Address;
    // Consumed before the signature check, so a nonce can never be tried twice.
    const issuedTo = await this.store.consumeNonce(nonce);
    if (issuedTo !== normalized)
      throw invalid("The sign-in nonce is unknown, expired or already used");

    const kind = await this.verifySignature(normalized, chainId, message, signature);
    return { address: normalized, kind, chainId };
  }

  private async checkOrigin(domain: string, uri: string): Promise<void> {
    let origin: URL;
    try {
      origin = new URL(uri);
    } catch {
      throw invalid("The message URI is not a URL");
    }
    if (origin.host !== domain) throw invalid("The message domain does not match its URI");
    if (!(await this.origins.isAllowed(origin.origin))) {
      throw invalid(`Sign-in from ${origin.origin} is not allowed`);
    }
  }

  private checkTimes(issuedAt: Date, expirationTime?: Date, notBefore?: Date): void {
    const now = Date.now();
    const issued = issuedAt.getTime();
    if (Number.isNaN(issued) || issued > now + CLOCK_SKEW_MS)
      throw invalid("The message issue time is invalid");
    if (now - issued > AUTH_LIFETIMES.messageMaxAgeSeconds * 1000)
      throw invalid("The message is too old");
    if (expirationTime && !(expirationTime.getTime() > now))
      throw invalid("The message has expired");
    if (notBefore && !(notBefore.getTime() <= now + CLOCK_SKEW_MS))
      throw invalid("The message is not valid yet");
  }

  /** Plain keys are checked locally; smart-contract wallets (EIP-1271, EIP-6492) on-chain. */
  private async verifySignature(
    address: Address,
    chainId: number,
    message: string,
    signature: Hex,
  ): Promise<WalletKind> {
    try {
      const recovered = await recoverMessageAddress({ message, signature });
      if (recovered.toLowerCase() === address) return "EOA";
    } catch {
      // Not a plain ECDSA signature; it may still be a contract wallet signature.
    }

    const valid = await this.chains
      .get(chainId)
      .verifyMessage({ address, message, signature })
      .catch(() => false);
    if (valid) return "CONTRACT";
    throw invalid("The signature does not match the address");
  }
}

function invalid(reason: string): AppException {
  return AppException.unauthenticated(reason);
}
