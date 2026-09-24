import { BadRequestException, type PipeTransform } from "@nestjs/common";
import { z } from "zod";

/** Parses a route parameter, query or body with a shared zod schema. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(z.prettifyError(result.error));
    }
    return result.data;
  }
}
