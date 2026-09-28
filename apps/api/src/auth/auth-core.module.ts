import { Global, Module } from "@nestjs/common";
import { ContractsModule } from "../contracts/contracts.module.js";
import { RateLimitGuard } from "../common/rate-limit.js";
import { AllowedOriginsService } from "./allowed-origins.service.js";
import { ApiKeyVerifier } from "./api-key.verifier.js";
import { AuthStore } from "./auth.store.js";
import { AdminGuard, ApiKeyGuard, AuthGuard, OptionalAuthGuard } from "./guards.js";
import { OnchainRoleReader, ROLE_READER, RolesService } from "./roles.service.js";
import { SiweService } from "./siwe.service.js";
import { TokenService } from "./token.service.js";

const exported = [
  AllowedOriginsService,
  ApiKeyVerifier,
  AuthStore,
  RolesService,
  SiweService,
  TokenService,
  AuthGuard,
  OptionalAuthGuard,
  AdminGuard,
  ApiKeyGuard,
  RateLimitGuard,
];

/** Identity primitives every feature module needs: tokens, guards, signatures and roles. */
@Global()
@Module({
  imports: [ContractsModule],
  providers: [...exported, { provide: ROLE_READER, useClass: OnchainRoleReader }],
  exports: exported,
})
export class AuthCoreModule {}
