import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { ClaimRelayer } from "./claim-relayer.js";
import { GiveawayUnwinder } from "./giveaway-unwinder.js";
import { SettlementBuilder } from "./settlement-builder.js";
import { SettlementSubmitter } from "./settlement-submitter.js";

const QUEUE = "fd-settlement";

export type SettlementJobName = "build" | "submit" | "relay" | "cancel";

interface SettlementJob {
  sessionId: string;
}

/**
 * How long a finished job keeps its id, which is how often the reconciler can run the same step
 * for the same session again. Steps that find nothing to do (the chain has not caught up yet)
 * are retried at this pace instead of on every pass.
 */
const RERUN_AFTER_SECONDS: Record<SettlementJobName, number> = {
  build: 15,
  submit: 15,
  relay: 300,
  cancel: 60,
};

/**
 * Settlement steps as BullMQ jobs, keyed by step and session, so each runs once at a time across
 * every worker, survives restarts, and retries with backoff when an RPC call fails.
 */
@Injectable()
export class SettlementQueues implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SettlementQueues.name);
  private readonly connection: Redis;
  private readonly queue: Queue<SettlementJob>;
  private worker: Worker<SettlementJob> | null = null;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    private readonly builder: SettlementBuilder,
    private readonly submitter: SettlementSubmitter,
    private readonly relayer: ClaimRelayer,
    private readonly unwinder: GiveawayUnwinder,
  ) {
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    this.queue = new Queue(QUEUE, { connection: this.connection });
  }

  onApplicationBootstrap(): void {
    if (!this.env.SETTLEMENT_ENABLED) return;
    this.worker = new Worker<SettlementJob>(QUEUE, (job) => this.run(job), {
      connection: this.connection.duplicate(),
      concurrency: 8,
    });
    this.worker.on("failed", (job, error) => {
      this.logger.warn(
        `${job?.name ?? "?"} ${job?.data.sessionId ?? "?"} failed: ${error.message}`,
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }

  async schedule(name: SettlementJobName, sessionId: string): Promise<void> {
    await this.queue.add(
      name,
      { sessionId },
      {
        jobId: `${name}-${sessionId}`,
        attempts: 4,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: RERUN_AFTER_SECONDS[name] },
        removeOnFail: { age: 300 },
      },
    );
  }

  /** Runs one step directly. Exposed for tests and the reconciler. */
  async run(job: Pick<Job<SettlementJob>, "name" | "data">): Promise<void> {
    const { sessionId } = job.data;
    switch (job.name as SettlementJobName) {
      case "build":
        await this.builder.build(sessionId);
        return;
      case "submit":
        await this.submitter.submit(sessionId);
        return;
      case "relay":
        await this.relayer.relay(sessionId);
        return;
      case "cancel":
        await this.unwinder.cancel(sessionId);
        return;
    }
  }
}
