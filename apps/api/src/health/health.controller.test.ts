import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { healthResponseSchema } from "@fairdrops/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("GET /health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns a payload that satisfies the shared health contract", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/health")
      .expect(200);

    const body = healthResponseSchema.parse(response.body);
    expect(body.service).toBe("api");
    expect(body.status).toBe("ok");
  });
});
