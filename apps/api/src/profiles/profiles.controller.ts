import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  addressSchema,
  handleSchema,
  linkWalletRequestSchema,
  updateProfileRequestSchema,
  type Address,
  type LinkWalletRequest,
  type ProfileView,
  type UpdateProfileRequest,
  type WalletView,
} from "@fairdrops/shared";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AuthContext } from "../auth/auth.types.js";
import { AuthGuard, CurrentAuth } from "../auth/guards.js";
import { ProfilesService } from "./profiles.service.js";

@Controller("profiles")
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get("handle/:handle")
  byHandle(
    @Param("handle", new ZodValidationPipe(handleSchema)) handle: string,
  ): Promise<ProfileView> {
    return this.profiles.byHandle(handle);
  }

  @Get("wallet/:address")
  byWallet(
    @Param("address", new ZodValidationPipe(addressSchema)) address: Address,
  ): Promise<ProfileView> {
    return this.profiles.byWallet(address);
  }

  @Patch("me")
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: "profile-write", limit: 30, windowSeconds: 60, by: "user" })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateProfileRequestSchema)) body: UpdateProfileRequest,
  ): Promise<ProfileView> {
    return this.profiles.update(auth.userId, body);
  }
}

@Controller("wallets")
@UseGuards(AuthGuard)
export class WalletsController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<WalletView[]> {
    return this.profiles.wallets(auth.userId);
  }

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "wallet-link", limit: 10, windowSeconds: 60, by: "user" })
  link(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(linkWalletRequestSchema)) body: LinkWalletRequest,
  ): Promise<WalletView[]> {
    return this.profiles.linkWallet(auth.userId, body);
  }

  @Delete(":address")
  unlink(
    @CurrentAuth() auth: AuthContext,
    @Param("address", new ZodValidationPipe(addressSchema)) address: Address,
  ): Promise<WalletView[]> {
    return this.profiles.unlinkWallet(auth.userId, auth.wallet, address);
  }
}
