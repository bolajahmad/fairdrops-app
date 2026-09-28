import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { Redis } from "ioredis";
import { REDIS } from "../infra/redis.module.js";
import { AppException } from "./app.exception.js";

export interface RateLimitOptions {
  /** Bucket name, shared by every route that uses it. */
  name: string;
  limit: number;
  windowSeconds: number;
  /** `user` requires an authenticated route; `ip` works anywhere. */
  by: "ip" | "user";
}

const RATE_LIMIT = Symbol("RATE_LIMIT");

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT, options);

// Increments the window's counter and sets its expiry in one atomic step.
const INCREMENT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return count`;

/** Fixed-window request limits backed by Redis, so they hold across API instances. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const subject = options.by === "user" ? request.auth?.userId : request.ip;
    if (!subject) throw new Error(`Rate limit "${options.name}" by ${options.by} has no subject`);

    const window = Math.floor(Date.now() / 1000 / options.windowSeconds);
    const key = `ratelimit:${options.name}:${subject}:${window}`;
    const count = Number(await this.redis.eval(INCREMENT, 1, key, options.windowSeconds));

    if (count > options.limit) {
      const retryAfter =
        options.windowSeconds - (Math.floor(Date.now() / 1000) % options.windowSeconds);
      throw new AppException("RATE_LIMITED", "Too many requests, try again shortly", undefined, {
        "Retry-After": String(retryAfter),
      });
    }
    return true;
  }
}
