import type { Redis } from "ioredis";

const RENEW = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0`;

const RELEASE = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

/**
 * An expiring hold on a key in Redis, used so one worker plans sessions and one worker runs each
 * game. A lease only says who should do the work; writes that must not overlap are also fenced
 * in Postgres, because a paused holder can outlive its lease.
 */
export class Lease {
  constructor(
    private readonly redis: Redis,
    readonly key: string,
    readonly holder: string,
    private readonly ttlMs: number,
  ) {}

  async acquire(): Promise<boolean> {
    return (await this.redis.set(this.key, this.holder, "PX", this.ttlMs, "NX")) === "OK";
  }

  /** Extends the lease if this holder still has it. */
  async renew(): Promise<boolean> {
    return Number(await this.redis.eval(RENEW, 1, this.key, this.holder, this.ttlMs)) === 1;
  }

  async release(): Promise<void> {
    await this.redis.eval(RELEASE, 1, this.key, this.holder);
  }
}
