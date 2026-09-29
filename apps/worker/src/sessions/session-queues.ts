import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { DelayedError, Queue, Worker, type Job } from "bullmq";
import type { Address, Hex } from "@fairdrops/shared";
import { Redis } from "ioredis";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { SEED_COMMITTER, SeedCommitConflict, type SeedCommitter } from "./seed-committer.js";
import { SessionLifecycle } from "./session-lifecycle.js";

interface SessionJob {
  sessionId: string;
}

const COMMITS = "fd-seed-commits";
const STARTS = "fd-session-starts";

/**
 * Durable timers for sessions, in Redis via BullMQ, so they survive restarts and fire once
 * across workers: a seed commit as soon as a session is planned, and its start at the scheduled
 * time. Job ids are derived from the session, so scheduling twice is a no-op. The planner also
 * reconciles on every tick, so a lost job only delays a transition.
 */
@Injectable()
export class SessionQueues implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SessionQueues.name);
  private readonly connection: Redis;
  private readonly commits: Queue<SessionJob>;
  private readonly starts: Queue<SessionJob>;
  private readonly workers: Worker<SessionJob>[] = [];

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) private readonly db: Database,
    @Inject(SEED_COMMITTER) private readonly committer: SeedCommitter,
    private readonly lifecycle: SessionLifecycle,
  ) {
    // BullMQ's blocking workers need a connection that retries forever.
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    this.commits = new Queue(COMMITS, { connection: this.connection });
    this.starts = new Queue(STARTS, { connection: this.connection });
  }

  onApplicationBootstrap(): void {
    if (!this.env.SESSIONS_ENABLED) return;
    // Commits run one at a time per worker, so the operator's nonces go out in order.
    this.workers.push(
      new Worker<SessionJob>(COMMITS, (job) => this.commitSeed(job), {
        connection: this.connection.duplicate(),
        concurrency: 1,
      }),
      new Worker<SessionJob>(STARTS, (job) => this.start(job), {
        connection: this.connection.duplicate(),
        concurrency: 10,
      }),
    );
    for (const worker of this.workers) {
      worker.on("failed", (job, error) => {
        this.logger.warn(`${worker.name} job ${job?.id ?? "?"} failed: ${error.message}`);
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([this.commits.close(), this.starts.close()]);
    this.connection.disconnect();
  }

  async scheduleCommit(sessionId: string): Promise<void> {
    await this.commits.add(
      "commit",
      { sessionId },
      {
        jobId: `commit-${sessionId}`,
        attempts: 8,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: 1_000,
      },
    );
  }

  async scheduleStart(sessionId: string, startsAt: Date): Promise<void> {
    await this.starts.add(
      "start",
      { sessionId },
      {
        jobId: `start-${sessionId}`,
        delay: Math.max(0, startsAt.getTime() - Date.now()),
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: 1_000,
      },
    );
  }

  /** Commits a session's seed; transient failures throw so BullMQ retries with backoff. */
  async commitSeed(job: Pick<Job<SessionJob>, "data">): Promise<void> {
    const session = await this.db.gameSession.findUnique({
      where: { id: job.data.sessionId },
      include: { giveaway: { select: { contractAddress: true } } },
    });
    if (!session || session.status !== "SCHEDULED") return;
    if (session.startsAt.getTime() <= Date.now()) return; // Too late; the start fails it.

    try {
      const txHash = await this.committer.commit({
        chainId: session.chainId,
        contract: session.giveaway.contractAddress as Address,
        giveawayId: session.giveawayId as Hex,
        commitment: session.seedCommitment as Hex,
      });
      await this.lifecycle.seedCommitted(session.id, txHash);
    } catch (error) {
      if (error instanceof SeedCommitConflict) {
        await this.lifecycle.fail(session.id, ["SCHEDULED"], error.message);
        return;
      }
      throw error;
    }
  }

  private async start(job: Job<SessionJob>): Promise<void> {
    const status = await this.lifecycle.start(job.data.sessionId);
    if (status !== null) return;
    // A job can fire slightly early when machine clocks differ; wait for the scheduled time.
    const session = await this.db.gameSession.findUnique({
      where: { id: job.data.sessionId },
      select: { startsAt: true },
    });
    if (session && session.startsAt.getTime() > Date.now() && job.token) {
      await job.moveToDelayed(session.startsAt.getTime(), job.token);
      throw new DelayedError();
    }
  }
}
