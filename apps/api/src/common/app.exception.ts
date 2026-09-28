import { HttpException, HttpStatus } from "@nestjs/common";
import type { ErrorCode } from "@fairdrops/shared";

const STATUS: Record<ErrorCode, HttpStatus> = {
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** An error with a stable code from the shared error envelope. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers: Record<string, string> = {},
  ) {
    super(message, STATUS[code]);
  }

  static notFound(message: string): AppException {
    return new AppException("NOT_FOUND", message);
  }

  static conflict(message: string, details?: unknown): AppException {
    return new AppException("CONFLICT", message, details);
  }

  static forbidden(message: string): AppException {
    return new AppException("FORBIDDEN", message);
  }

  static unauthenticated(message = "Sign in required"): AppException {
    return new AppException("UNAUTHENTICATED", message);
  }
}
