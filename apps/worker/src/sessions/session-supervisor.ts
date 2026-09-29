import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import { sessionKeys } from "@fairdrops/shared";
import { Redis } from "ioredis";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { REDIS } from "../infra/redis.module.js";
import { Lease } from "./lease.js";
import { SeedVault } from "./seed-vault.js";
import { SessionBus } from "./session-bus.js";
import { SessionLifecycle } from "./session-lifecycle.js";
import { SessionOwner, type OwnerOutcome } from "./session-owner.js";
import { WORKER_ID } from "./worker-id.js";

const SUPERVISE_INTERVAL_MS = 1_000;

/**
 * Makes sure every running hosted game has exactly one worker running it. Each worker claims
 * unowned games up to SESSION_MAX_OWNED; when a worker stops or dies its leases lapse and the
 * others pick its games up, rebuilding them from the action log.
 */
@Injectable()
export class SessionSupervisor implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(SessionSupervisor.name);
  private readonly abort = new AbortController();
  private readonly owners = new Map<string, { owner: SessionOwner; done: Promise<void> }>();
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly bus: SessionBus,
    private readonly lifecycle: SessionLifecycle,
    private readonly vault: SeedVault,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.SESSIONS_ENABLED) this.loop = this.run();
  }

  /** Stops claiming games and hands the running ones back, before the database disconnects. */
  async beforeApplicationShutdown(): Promise<void> {
    this.abort.abort();
    await this.loop;
    for (const { owner } of this.owners.values()) owner.stop();
    await Promise.allSettled([...this.owners.values()].map((entry) => entry.done));
  }

  /** Session ids this worker is running. */
  running(): string[] {
    return [...this.owners.keys()];
  }

  /** Claims unowned running games. Returns how many it started. */
  async claim(): Promise<number> {
    const room = this.env.SESSION_MAX_OWNED - this.owners.size;
    if (room <= 0) return 0;
    const candidates = await this.db.gameSession.findMany({
      where: { status: "RUNNING", mode: "HOSTED", id: { notIn: this.running() } },
      select: { id: true },
      orderBy: { startsAt: "asc" },
      take: room,
    });

    let started = 0;
    for (const { id } of candidates) {
      const lease = new Lease(
        this.redis,
        sessionKeys.owner(id),
        WORKER_ID,
        this.env.SESSION_LEASE_MS,
      );
      if (!(await lease.acquire())) continue;
      this.start(id, lease);
      started += 1;
    }
    return started;
  }

  private start(sessionId: string, lease: Lease): void {
    const owner = new SessionOwner(sessionId, lease, {
      db: this.db,
      redis: this.redis,
      bus: this.bus,
      lifecycle: this.lifecycle,
      vault: this.vault,
      logger: this.logger,
    });
    this.logger.log(`Running session ${sessionId}`);
    const done = owner
      .run()
      .then((outcome: OwnerOutcome) => {
        this.logger.log(`Session ${sessionId}: runtime ${outcome}`);
      })
      .catch((error: unknown) => {
        this.logger.error(`Session ${sessionId}: runtime failed: ${(error as Error).message}`);
      })
      .finally(() => {
        this.owners.delete(sessionId);
      });
    this.owners.set(sessionId, { owner, done });
  }

  private async run(): Promise<void> {
    const { signal } = this.abort;
    while (!signal.aborted) {
      try {
        await this.claim();
      } catch (error) {
        this.logger.warn(`Claiming sessions failed: ${(error as Error).message}`);
      }
      await sleep(SUPERVISE_INTERVAL_MS, undefined, { signal }).catch(() => undefined);
    }
  }
}
