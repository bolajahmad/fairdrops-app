import { Inject, Injectable } from "@nestjs/common";
import type { HealthResponse } from "@fairdrops/shared";
import { API_ENV, type ApiEnv } from "../config/env.js";

@Injectable()
export class HealthService {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  check(): HealthResponse {
    return {
      service: "api",
      status: "ok",
      version: this.env.APP_VERSION,
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
