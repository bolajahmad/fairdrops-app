import { errorResponseSchema, type ErrorCode, type WsErrorCode } from "@fairdrops/shared";

/**
 * An error from the FairDrops API (with its stable `code`), or one the SDK raises itself with the
 * same codes: for example RATE_LIMITED before sending too many actions.
 */
export class FairDropsError extends Error {
  constructor(
    readonly code: ErrorCode | WsErrorCode | "NETWORK" | "BAD_RESPONSE",
    message: string,
    readonly status: number | null = null,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "FairDropsError";
  }

  static async fromResponse(response: Response): Promise<FairDropsError> {
    const body: unknown = await response.json().catch(() => null);
    const parsed = errorResponseSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details, requestId } = parsed.data.error;
      return new FairDropsError(code, message, response.status, details, requestId);
    }
    return new FairDropsError(
      "BAD_RESPONSE",
      `${response.status} ${response.statusText}`.trim(),
      response.status,
    );
  }
}
