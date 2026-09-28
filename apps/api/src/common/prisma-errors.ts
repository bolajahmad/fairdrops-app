import { Prisma, UNIQUE_VIOLATION } from "@fairdrops/db";

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}
