import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@fairdrops/shared";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): HealthResponse {
    return this.health.check();
  }
}
