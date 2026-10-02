import { Inject, Injectable } from "@nestjs/common";
import type { GameResource, Prisma } from "@fairdrops/db";
import {
  builtinQuizBanks,
  findResourceKind,
  hashJson,
  quizBankKind,
  quizBankSchema,
  resourceKinds,
} from "@fairdrops/game-kit";
import type {
  CreateGameResourceRequest,
  GameResourceView,
  Hex,
  QuizBankView,
} from "@fairdrops/shared";
import { z } from "zod";
import { AppException } from "../common/app.exception.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";

function toView(resource: GameResource): GameResourceView {
  return {
    hash: resource.hash as Hex,
    kind: resource.kind,
    summary: resource.summary,
    createdAt: resource.createdAt.toISOString(),
  };
}

@Injectable()
export class GameResourcesService {
  /** Every question bank, built-ins first: names and sizes only, never the questions. */
  async quizBanks(): Promise<QuizBankView[]> {
    const rows = await this.db.gameResource.findMany({
      where: { kind: quizBankKind.kind },
      select: { hash: true, content: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const builtin = new Set(builtinQuizBanks.map((entry) => entry.hash));
    return rows
      .map((row) => {
        const bank = quizBankSchema.safeParse(row.content);
        return bank.success
          ? {
              hash: row.hash as Hex,
              name: bank.data.name,
              questions: bank.data.questions.length,
              builtin: builtin.has(row.hash as Hex),
            }
          : null;
      })
      .filter((bank): bank is QuizBankView => bank !== null)
      .sort((a, b) => Number(b.builtin) - Number(a.builtin));
  }

  constructor(@Inject(PRISMA) private readonly db: Database) {}

  /** Stores validated content under its hash. Uploading the same content again is a no-op. */
  async create(userId: string, body: CreateGameResourceRequest): Promise<GameResourceView> {
    const kind = findResourceKind(body.kind);
    if (!kind) {
      const known = resourceKinds.map((k) => k.kind).join(", ");
      throw new AppException(
        "VALIDATION_FAILED",
        `Unknown resource kind; expected one of ${known}`,
      );
    }
    const parsed = kind.schema.safeParse(body.content);
    if (!parsed.success) {
      throw new AppException("VALIDATION_FAILED", z.prettifyError(parsed.error));
    }

    const hash = hashJson(parsed.data);
    const resource = await this.db.gameResource.upsert({
      where: { hash },
      create: {
        hash,
        kind: kind.kind,
        summary: kind.summary(parsed.data),
        content: parsed.data as Prisma.InputJsonValue,
        createdById: userId,
      },
      update: {},
    });
    return toView(resource);
  }

  /** Lists resources without their content, which stays private. */
  async list(kind?: string): Promise<GameResourceView[]> {
    const rows = await this.db.gameResource.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map(toView);
  }
}
