import { Inject, Injectable } from "@nestjs/common";
import type { GameDefinition, Prisma } from "@fairdrops/db";
import {
  modeFieldIssues,
  type Address,
  type CreateGameDefinitionRequest,
  type GameDefinitionListQuery,
  type GameDefinitionStatus,
  type GameDefinitionView,
  type Hex,
  type Page,
  type UpdateGameDefinitionRequest,
} from "@fairdrops/shared";
import { AllowedOriginsService } from "../auth/allowed-origins.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { AppException } from "../common/app.exception.js";
import { isUniqueViolation } from "../common/prisma-errors.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";

const PUBLIC_STATUSES: GameDefinitionStatus[] = ["APPROVED", "DISABLED"];

interface GameKey {
  id: string;
  version: string;
}

function toView(game: GameDefinition): GameDefinitionView {
  return {
    id: game.id,
    version: game.version,
    name: game.name,
    description: game.description,
    mode: game.mode,
    status: game.status,
    configSchema: game.configSchema as Record<string, unknown>,
    uiUrl: game.uiUrl,
    reporterAddress: game.reporterAddress as Address | null,
    codeHash: game.codeHash as Hex | null,
    ownerId: game.ownerId,
    reviewNote: game.reviewNote,
    submittedAt: game.submittedAt?.toISOString() ?? null,
    reviewedAt: game.reviewedAt?.toISOString() ?? null,
    createdAt: game.createdAt.toISOString(),
    updatedAt: game.updatedAt.toISOString(),
  };
}

function encodeCursor(game: GameKey): string {
  return Buffer.from(`${game.id}@${game.version}`).toString("base64url");
}

function decodeCursor(cursor: string): GameKey {
  const [id, version] = Buffer.from(cursor, "base64url").toString("utf8").split("@");
  if (!id || !version) throw new AppException("VALIDATION_FAILED", "Invalid cursor");
  return { id, version };
}

@Injectable()
export class GamesService {
  constructor(
    @Inject(PRISMA) private readonly db: Database,
    private readonly origins: AllowedOriginsService,
  ) {}

  async create(ownerId: string, body: CreateGameDefinitionRequest): Promise<GameDefinitionView> {
    // A game id belongs to whoever registered it first; others cannot publish versions under it.
    const other = await this.db.gameDefinition.findFirst({
      where: { id: body.id, ownerId: { not: ownerId } },
      select: { ownerId: true },
    });
    if (other)
      throw AppException.forbidden(`The game id "${body.id}" belongs to another developer`);

    try {
      const game = await this.db.gameDefinition.create({
        data: { ...body, configSchema: body.configSchema as Prisma.InputJsonObject, ownerId },
      });
      return toView(game);
    } catch (error) {
      if (isUniqueViolation(error))
        throw AppException.conflict(`${body.id}@${body.version} already exists`);
      throw error;
    }
  }

  async list(
    query: GameDefinitionListQuery,
    auth: AuthContext | undefined,
  ): Promise<Page<GameDefinitionView>> {
    let where: Prisma.GameDefinitionWhereInput;
    if (query.owner === "mine") {
      if (!auth) throw AppException.unauthenticated("Sign in to list your own games");
      where = { ownerId: auth.userId, ...(query.status ? { status: query.status } : {}) };
    } else {
      if (query.status && !PUBLIC_STATUSES.includes(query.status)) {
        throw AppException.forbidden("Only approved or disabled games are listed publicly");
      }
      where = { status: query.status ?? "APPROVED" };
    }
    return this.page(where, query);
  }

  async reviewQueue(query: GameDefinitionListQuery): Promise<Page<GameDefinitionView>> {
    return this.page({ status: "PENDING_REVIEW" }, query);
  }

  async get(key: GameKey, auth: AuthContext | undefined): Promise<GameDefinitionView> {
    return toView(await this.findVisible(key, auth));
  }

  async update(
    auth: AuthContext,
    key: GameKey,
    body: UpdateGameDefinitionRequest,
  ): Promise<GameDefinitionView> {
    const current = await this.findOwned(key, auth);
    if (current.status !== "DRAFT")
      throw AppException.conflict(`Only drafts can be edited; this game is ${current.status}`);

    const reporterAddress =
      body.reporterAddress === undefined ? current.reporterAddress : body.reporterAddress;
    const issues = modeFieldIssues({ mode: current.mode, reporterAddress });
    if (issues.length > 0) throw new AppException("VALIDATION_FAILED", issues.join("; "));

    const { configSchema, ...rest } = body;
    return this.transition(
      key,
      ["DRAFT"],
      "DRAFT",
      {
        ...rest,
        ...(configSchema ? { configSchema: configSchema as Prisma.InputJsonObject } : {}),
      },
      { ownerId: auth.userId },
    );
  }

  async submit(auth: AuthContext, key: GameKey): Promise<GameDefinitionView> {
    await this.findOwned(key, auth);
    return this.transition(
      key,
      ["DRAFT"],
      "PENDING_REVIEW",
      { submittedAt: new Date(), reviewNote: null },
      {
        ownerId: auth.userId,
      },
    );
  }

  async approve(
    admin: AuthContext,
    key: GameKey,
    note: string | undefined,
  ): Promise<GameDefinitionView> {
    const view = await this.transition(
      key,
      ["PENDING_REVIEW"],
      "APPROVED",
      this.review(admin, note),
    );
    this.origins.invalidate();
    return view;
  }

  async reject(
    admin: AuthContext,
    key: GameKey,
    note: string | undefined,
  ): Promise<GameDefinitionView> {
    return this.transition(key, ["PENDING_REVIEW"], "DRAFT", this.review(admin, note));
  }

  async disable(
    admin: AuthContext,
    key: GameKey,
    note: string | undefined,
  ): Promise<GameDefinitionView> {
    const view = await this.transition(key, ["APPROVED"], "DISABLED", this.review(admin, note));
    this.origins.invalidate();
    return view;
  }

  private review(admin: AuthContext, note: string | undefined) {
    return { reviewedById: admin.userId, reviewedAt: new Date(), reviewNote: note ?? null };
  }

  /**
   * Moves a definition between statuses with a conditional update, so concurrent reviews or
   * edits cannot both succeed: whoever loses sees the status that won.
   */
  private async transition(
    key: GameKey,
    from: GameDefinitionStatus[],
    to: GameDefinitionStatus,
    data: Prisma.GameDefinitionUpdateManyMutationInput,
    extraWhere: Prisma.GameDefinitionWhereInput = {},
  ): Promise<GameDefinitionView> {
    const result = await this.db.gameDefinition.updateMany({
      where: { ...key, status: { in: from }, ...extraWhere },
      data: { ...data, status: to },
    });
    const game = await this.db.gameDefinition.findUnique({ where: { id_version: key } });
    if (!game) throw AppException.notFound(`${key.id}@${key.version} does not exist`);
    if (result.count === 0) {
      throw AppException.conflict(
        `${key.id}@${key.version} is ${game.status}, expected ${from.join(" or ")}`,
      );
    }
    return toView(game);
  }

  private async findVisible(key: GameKey, auth: AuthContext | undefined): Promise<GameDefinition> {
    const game = await this.db.gameDefinition.findUnique({ where: { id_version: key } });
    const visible =
      game &&
      (PUBLIC_STATUSES.includes(game.status) ||
        game.ownerId === auth?.userId ||
        auth?.roles.includes("admin"));
    if (!game || !visible) throw AppException.notFound(`${key.id}@${key.version} does not exist`);
    return game;
  }

  private async findOwned(key: GameKey, auth: AuthContext): Promise<GameDefinition> {
    const game = await this.db.gameDefinition.findUnique({ where: { id_version: key } });
    if (!game || game.ownerId !== auth.userId) {
      if (game && PUBLIC_STATUSES.includes(game.status))
        throw AppException.forbidden("You do not own this game");
      throw AppException.notFound(`${key.id}@${key.version} does not exist`);
    }
    return game;
  }

  private async page(
    where: Prisma.GameDefinitionWhereInput,
    query: GameDefinitionListQuery,
  ): Promise<Page<GameDefinitionView>> {
    const rows = await this.db.gameDefinition.findMany({
      where,
      orderBy: [{ id: "asc" }, { version: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id_version: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(toView),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }
}
