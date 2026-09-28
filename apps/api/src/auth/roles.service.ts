import { Inject, Injectable, Logger } from "@nestjs/common";
import { fairDropsAbi } from "@fairdrops/contracts";
import type { Address, Role } from "@fairdrops/shared";
import { Redis } from "ioredis";
import { zeroHash } from "viem";
import { API_ENV, type ApiEnv } from "../config/env.js";
import { ContractsService } from "../contracts/contracts.service.js";
import { ChainClients } from "../infra/chain-clients.service.js";
import { REDIS } from "../infra/redis.module.js";

const CACHE_TTL_SECONDS = 60;
const DEFAULT_ADMIN_ROLE = zeroHash;

export const ROLE_READER = Symbol("ROLE_READER");

/** Reads role membership from a deployed FairDrops contract. Replaced by a stub in tests. */
export interface RoleReader {
  isDefaultAdmin(chainId: number, contract: Address, account: Address): Promise<boolean>;
}

@Injectable()
export class OnchainRoleReader implements RoleReader {
  constructor(private readonly chains: ChainClients) {}

  isDefaultAdmin(chainId: number, contract: Address, account: Address): Promise<boolean> {
    return this.chains.get(chainId).readContract({
      address: contract,
      abi: fairDropsAbi,
      functionName: "hasRole",
      args: [DEFAULT_ADMIN_ROLE, account],
    });
  }
}

export class RoleCheckUnavailableError extends Error {
  constructor() {
    super("Could not reach any chain to verify the admin role");
  }
}

/**
 * Admin rights are not configured in the API: a wallet is an admin when it holds
 * DEFAULT_ADMIN_ROLE on a FairDrops deployment in this environment. Results are cached briefly
 * so admin pages do not hit every RPC on each request.
 */
@Injectable()
export class RolesService {
  private readonly logger = new Logger("RolesService");

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ROLE_READER) private readonly reader: RoleReader,
    private readonly contracts: ContractsService,
  ) {}

  /** Roles to embed in an access token. Fails closed: an unreachable chain grants nothing. */
  async rolesFor(wallet: Address): Promise<Role[]> {
    try {
      return (await this.isAdmin(wallet)) ? ["admin"] : [];
    } catch (error) {
      this.logger.warn(`Role lookup failed for ${wallet}: ${String(error)}`);
      return [];
    }
  }

  /** @throws RoleCheckUnavailableError when no deployment could be queried. */
  async isAdmin(wallet: Address): Promise<boolean> {
    if (this.env.LOCAL_ADMIN_ADDRESSES.includes(wallet)) return true;

    const cacheKey = `roles:admin:${wallet}`;
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return cached === "1";

    const deployments = this.contracts.forEnvironment(this.env.DEPLOYMENT_ENVIRONMENT).contracts;
    if (deployments.length === 0) return false;

    const results = await Promise.allSettled(
      deployments.map((d) => this.reader.isDefaultAdmin(d.chainId, d.address, wallet)),
    );
    const isAdmin = results.some((r) => r.status === "fulfilled" && r.value);
    const answered = results.some((r) => r.status === "fulfilled");
    if (!answered) throw new RoleCheckUnavailableError();

    // Only cache a negative answer when every chain answered, so an outage cannot hide a role.
    const complete = results.every((r) => r.status === "fulfilled");
    if (isAdmin || complete) {
      await this.redis.set(cacheKey, isAdmin ? "1" : "0", "EX", CACHE_TTL_SECONDS);
    }
    return isAdmin;
  }
}
