import type { SocialLink, User, Wallet } from "@fairdrops/db";
import {
  defaultDisplayName,
  socialUrl,
  type Address,
  type ProfileView,
  type WalletView,
} from "@fairdrops/shared";

export type UserWithRelations = User & { wallets: Wallet[]; socials: SocialLink[] };

export const profileInclude = {
  wallets: { orderBy: { linkedAt: "asc" } },
  socials: { orderBy: { platform: "asc" } },
} as const;

export function toProfileView(user: UserWithRelations): ProfileView {
  const firstWallet = user.wallets[0]?.address ?? "";
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName ?? user.handle ?? defaultDisplayName(firstWallet),
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    socials: user.socials.map((s) => ({
      platform: s.platform,
      handle: s.handle,
      url: socialUrl(s.platform, s.handle),
      verifiedAt: s.verifiedAt?.toISOString() ?? null,
    })),
    wallets: user.wallets.map((w) => w.address as Address),
    createdAt: user.createdAt.toISOString(),
  };
}

export function toWalletView(wallet: Wallet): WalletView {
  return {
    address: wallet.address as Address,
    kind: wallet.kind,
    connector: wallet.connector,
    linkedAt: wallet.linkedAt.toISOString(),
    lastSignInAt: wallet.lastSignInAt?.toISOString() ?? null,
  };
}
