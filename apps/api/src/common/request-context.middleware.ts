import { randomUUID } from "node:crypto";
import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

const INCOMING_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Assigns every request an id, echoes it back, and logs one line when the response ends. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.header("x-request-id");
    const requestId = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);

    const started = process.hrtime.bigint();
    response.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      this.logger.log(
        `${request.method} ${request.originalUrl} ${response.statusCode} ${ms.toFixed(1)}ms ${requestId}`,
      );
    });
    next();
  }
}
