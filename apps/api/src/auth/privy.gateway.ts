import { Inject, Injectable } from "@nestjs/common";
import type { Address, LoginMethod } from "@fairdrops/shared";
import { PrivyClient, type User } from "@privy-io/node";
import { AppException } from "../common/app.exception.js";
import { API_ENV, type ApiEnv } from "../config/env.js";

export const PRIVY_GATEWAY = Symbol("PRIVY_GATEWAY");

/** Who a Privy access token belongs to, read from Privy itself. */
export interface PrivyIdentity {
  /** The Privy user id (a DID). One Privy user is one FairDrops account. */
  userId: string;
  method: Exclude<LoginMethod, "wallet">;
  /** Display only: the provider's username or name. */
  handle: string | null;
  /** The person's Privy embedded wallet, created now if the app hasn't yet. */
  wallet: Address;
}

export interface PrivyGateway {
  readonly enabled: boolean;
  /** Verifies the token's signature, issuer, audience and expiry, then loads the user. */
  identify(accessToken: string): Promise<PrivyIdentity>;
}

type Linked = User["linked_accounts"][number];

/** Privy sign-ins FairDrops accepts, in the order a user's primary one is picked. */
const LOGINS: Record<string, Exclude<LoginMethod, "wallet">> = {
  google_oauth: "google",
  email: "email",
  passkey: "passkey",
};

@Injectable()
export class PrivyClientGateway implements PrivyGateway {
  private readonly client: PrivyClient | null;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client =
      env.PRIVY_APP_ID && env.PRIVY_APP_SECRET
        ? new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET })
        : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async identify(accessToken: string): Promise<PrivyIdentity> {
    const client = this.client;
    if (!client) throw AppException.forbidden("Social sign-in isn't set up on this server");

    let userId: string;
    try {
      ({ user_id: userId } = await client.utils().auth().verifyAccessToken(accessToken));
    } catch {
      throw AppException.unauthenticated("The Privy sign-in is invalid or has expired");
    }

    // The user comes from Privy's API with our app secret, never from the request.
    let user = await client.users()._get(userId);
    let wallet = embeddedWallet(user);
    if (!wallet) {
      user = await client.users().pregenerateWallets(userId, {
        wallets: [{ chain_type: "ethereum" }],
      });
      wallet = embeddedWallet(user);
    }
    if (!wallet) {
      throw new AppException("INTERNAL", "Couldn't create a wallet for this account");
    }

    const login = socialLogin(user);
    if (!login) {
      throw AppException.forbidden("Sign in with Google, email or a passkey, or with a wallet");
    }
    return { userId, wallet, ...login };
  }
}

function embeddedWallet(user: User): Address | null {
  for (const account of user.linked_accounts) {
    if (
      account.type === "wallet" &&
      "wallet_client_type" in account &&
      account.wallet_client_type === "privy" &&
      account.chain_type === "ethereum"
    ) {
      return account.address.toLowerCase() as Address;
    }
  }
  return null;
}

function socialLogin(user: User): Pick<PrivyIdentity, "method" | "handle"> | null {
  for (const [type, method] of Object.entries(LOGINS)) {
    const account = user.linked_accounts.find((linked: Linked) => linked.type === type);
    if (!account) continue;
    const fields = account as {
      name?: string | null;
      address?: string;
      authenticator_name?: string;
    };
    const handle =
      method === "email"
        ? maskEmail(fields.address)
        : method === "passkey"
          ? (fields.authenticator_name ?? null)
          : (fields.name ?? null);
    return { method, handle: handle?.slice(0, 64) ?? null };
  }
  return null;
}

/**
 * "a••••@gmail.com": enough for someone to recognise their own account, without keeping or
 * showing their full address.
 */
export function maskEmail(address: string | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (at < 1) return null;
  return `${address[0]}••••${address.slice(at)}`;
}
