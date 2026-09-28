import type { PipeTransform } from "@nestjs/common";
import { z } from "zod";
import { AppException } from "./app.exception.js";

/** Parses a route parameter, query or body with a shared zod schema. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException("VALIDATION_FAILED", z.prettifyError(result.error), {
        issues: result.error.issues.map(({ path, message }) => ({ path, message })),
      });
    }
    return result.data;
  }
}
