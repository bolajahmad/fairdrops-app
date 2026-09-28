import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ErrorCode, ErrorResponse } from "@fairdrops/shared";
import type { Request, Response } from "express";
import { AppException } from "./app.exception.js";

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
};

/** Renders every error as the shared envelope, and logs unexpected ones. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("ErrorFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorResponse["error"] = {
      code: "INTERNAL",
      message: "Something went wrong",
      requestId,
    };

    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, requestId };
      if (exception.details !== undefined) body.details = exception.details;
      for (const [name, value] of Object.entries(exception.headers))
        response.setHeader(name, value);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        code: CODE_BY_STATUS[status] ?? (status >= 500 ? "INTERNAL" : "BAD_REQUEST"),
        message: exception.message,
        requestId,
      };
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} failed (request ${requestId ?? "unknown"})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({ error: body } satisfies ErrorResponse);
  }
}
