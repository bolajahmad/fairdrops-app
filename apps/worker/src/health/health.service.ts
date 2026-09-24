import { Inject, Injectable } from "@nestjs/common";
import type { HealthResponse } from "@fairdrops/shared";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";

@Injectable()
export class HealthService {
  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {}

  check(): HealthResponse {
    return {
      service: "worker",
      status: "ok",
      version: this.env.APP_VERSION,
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
