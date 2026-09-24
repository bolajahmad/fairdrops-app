import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { healthResponseSchema } from "@fairdrops/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HealthService } from "./health/health.service.js";
import { WorkerModule } from "./worker.module.js";

describe("WorkerModule", () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("resolves the health service and reports against the shared contract", () => {
    const body = healthResponseSchema.parse(moduleRef.get(HealthService).check());
    expect(body.service).toBe("worker");
  });
});
