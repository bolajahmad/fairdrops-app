import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ApiKeyScope } from "@fairdrops/shared";
import type { Request } from "express";
import { AppException } from "../common/app.exception.js";
import { ApiKeyVerifier } from "./api-key.verifier.js";
import { AuthStore } from "./auth.store.js";
import type { AuthContext } from "./auth.types.js";
import { RoleCheckUnavailableError, RolesService } from "./roles.service.js";
import { TokenService } from "./token.service.js";

function bearerToken(request: Request): string | undefined {
  const header = request.header("authorization");
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw AppException.unauthenticated("Expected an Authorization: Bearer header");
  }
  return token;
}

async function authenticate(
  tokens: TokenService,
  store: AuthStore,
  token: string,
): Promise<AuthContext> {
  const claims = await tokens.verify(token);
  if (await store.isSessionRevoked(claims.sid)) {
    throw AppException.unauthenticated("This session has been signed out");
  }
  return { userId: claims.sub, wallet: claims.wal, sessionId: claims.sid, roles: claims.roles };
}

/** Requires a valid access token and exposes it as `request.auth`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly store: AuthStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);
    if (!token) throw AppException.unauthenticated();
    request.auth = await authenticate(this.tokens, this.store, token);
    return true;
  }
}

/** Like AuthGuard, but lets anonymous requests through. A bad token is still rejected. */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly store: AuthStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);
    if (token) request.auth = await authenticate(this.tokens, this.store, token);
    return true;
  }
}

/**
 * Requires the signed-in wallet to hold DEFAULT_ADMIN_ROLE on-chain right now. The `roles`
 * claim in the token is not trusted for this, so a revoked admin loses access within the
 * role cache lifetime rather than the token lifetime. Use after AuthGuard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly roles: RolesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth) throw AppException.unauthenticated();
    try {
      if (await this.roles.isAdmin(auth.wallet)) return true;
    } catch (error) {
      if (error instanceof RoleCheckUnavailableError) {
        throw new AppException("INTERNAL", "Could not verify the admin role on-chain; try again");
      }
      throw error;
    }
    throw AppException.forbidden("Admin role required");
  }
}

const REQUIRED_SCOPES = Symbol("REQUIRED_SCOPES");

export const RequireScopes = (...scopes: ApiKeyScope[]) => SetMetadata(REQUIRED_SCOPES, scopes);

/** Authenticates game servers by the `X-API-Key` header and checks `@RequireScopes`. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: ApiKeyVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.header("x-api-key");
    if (!key) throw AppException.unauthenticated("Expected an X-API-Key header");

    const identity = await this.verifier.verify(key);
    const required =
      this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(REQUIRED_SCOPES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const missing = required.filter((scope) => !identity.scopes.includes(scope));
    if (missing.length > 0)
      throw AppException.forbidden(`API key lacks scope: ${missing.join(", ")}`);

    request.apiKey = identity;
    return true;
  }
}

/** The authenticated caller; only valid on routes behind AuthGuard. */
export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<Request>().auth;
  if (!auth) throw AppException.unauthenticated();
  return auth;
});

/** The caller if signed in, otherwise undefined; for routes behind OptionalAuthGuard. */
export const MaybeAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<Request>().auth,
);
