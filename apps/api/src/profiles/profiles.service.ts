import { Inject, Injectable } from "@nestjs/common";
import {
  HANDLE_CHANGE_COOLDOWN_DAYS,
  LINK_WALLET_STATEMENT,
  type Address,
  type LinkWalletRequest,
  type MeResponse,
  type ProfileView,
  type Role,
  type UpdateProfileRequest,
  type WalletView,
} from "@fairdrops/shared";
import { AppException } from "../common/app.exception.js";
import { isUniqueViolation } from "../common/prisma-errors.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { AuthStore } from "../auth/auth.store.js";
import { SiweService } from "../auth/siwe.service.js";
import { profileInclude, toProfileView, toWalletView } from "./profile.mapper.js";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(PRISMA) private readonly db: Database,
    private readonly siwe: SiweService,
    private readonly store: AuthStore,
  ) {}

  async byHandle(handle: string): Promise<ProfileView> {
    const user = await this.db.user.findUnique({ where: { handle }, include: profileInclude });
    if (!user) throw AppException.notFound(`No profile with handle ${handle}`);
    return toProfileView(user);
  }

  async byWallet(address: Address): Promise<ProfileView> {
    const wallet = await this.db.wallet.findUnique({
      where: { address },
      include: { user: { include: profileInclude } },
    });
    if (!wallet) throw AppException.notFound(`No profile for ${address}`);
    return toProfileView(wallet.user);
  }

  async me(userId: string, wallet: Address, roles: Role[], sessionId: string): Promise<MeResponse> {
    const [user, session] = await Promise.all([
      this.db.user.findUniqueOrThrow({ where: { id: userId }, include: profileInclude }),
      this.db.authSession.findUnique({ where: { id: sessionId }, select: { method: true } }),
    ]);
    const method = session?.method ?? "wallet";
    const identity =
      method === "wallet"
        ? null
        : await this.db.authIdentity.findFirst({
            where: { userId, method },
            select: { handle: true },
          });
    return {
      profile: toProfileView(user),
      wallets: user.wallets.map(toWalletView),
      wallet,
      roles,
      login: { method, handle: identity?.handle ?? null },
    };
  }

  async update(userId: string, body: UpdateProfileRequest): Promise<ProfileView> {
    try {
      await this.db.$transaction(async (tx) => {
        const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });

        if (body.handle !== undefined && body.handle !== current.handle) {
          const now = new Date();
          const cutoff = new Date(now.getTime() - HANDLE_CHANGE_COOLDOWN_DAYS * DAY_MS);
          // Conditional, so two concurrent changes cannot both slip inside the cooldown.
          const changed = await tx.user.updateMany({
            where: {
              id: userId,
              OR: [{ handleChangedAt: null }, { handleChangedAt: { lte: cutoff } }],
            },
            data: { handle: body.handle, handleChangedAt: now },
          });
          if (changed.count === 0) {
            const nextChange = new Date(
              (current.handleChangedAt?.getTime() ?? 0) + HANDLE_CHANGE_COOLDOWN_DAYS * DAY_MS,
            );
            throw AppException.conflict(
              `Your handle can change once every ${HANDLE_CHANGE_COOLDOWN_DAYS} days`,
              { nextChangeAt: nextChange.toISOString() },
            );
          }
        }

        const { displayName, bio, avatarUrl } = body;
        if (displayName !== undefined || bio !== undefined || avatarUrl !== undefined) {
          await tx.user.update({ where: { id: userId }, data: { displayName, bio, avatarUrl } });
        }

        if (body.socials) {
          await tx.socialLink.deleteMany({ where: { userId } });
          await tx.socialLink.createMany({
            data: body.socials.map((s) => ({ userId, platform: s.platform, handle: s.handle })),
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict("That handle is taken");
      throw error;
    }

    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: profileInclude,
    });
    return toProfileView(user);
  }

  async wallets(userId: string): Promise<WalletView[]> {
    const wallets = await this.db.wallet.findMany({
      where: { userId },
      orderBy: { linkedAt: "asc" },
    });
    return wallets.map(toWalletView);
  }

  /** Links another wallet after it signs a link message with a fresh nonce. */
  async linkWallet(userId: string, body: LinkWalletRequest): Promise<WalletView[]> {
    const verified = await this.siwe.verify(body.message, body.signature, LINK_WALLET_STATEMENT);

    const existing = await this.db.wallet.findUnique({ where: { address: verified.address } });
    if (existing && existing.userId !== userId) {
      throw AppException.conflict("This wallet already belongs to another account");
    }
    if (!existing) {
      try {
        await this.db.wallet.create({
          data: {
            address: verified.address,
            userId,
            kind: verified.kind,
            connector: body.connector,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const winner = await this.db.wallet.findUniqueOrThrow({
          where: { address: verified.address },
        });
        if (winner.userId !== userId)
          throw AppException.conflict("This wallet already belongs to another account");
      }
    }
    return this.wallets(userId);
  }

  /** Removes a wallet from the account and signs out every session that used it. */
  async unlinkWallet(
    userId: string,
    currentWallet: Address,
    address: Address,
  ): Promise<WalletView[]> {
    if (address === currentWallet) {
      throw AppException.conflict(
        "You are signed in with this wallet; sign in with another one to remove it",
      );
    }

    const revokedIds = await this.db.$transaction(async (tx) => {
      const removed = await tx.wallet.deleteMany({ where: { address, userId } });
      if (removed.count === 0)
        throw AppException.notFound(`${address} is not linked to your account`);

      const sessions = await tx.authSession.findMany({
        where: { userId, walletAddress: address, revokedAt: null },
        select: { id: true },
      });
      await tx.authSession.updateMany({
        where: { id: { in: sessions.map((s) => s.id) } },
        data: { revokedAt: new Date(), revokedReason: "wallet-unlinked" },
      });
      return sessions.map((s) => s.id);
    });
    await this.store.markSessionsRevoked(revokedIds);
    return this.wallets(userId);
  }
}
