import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@fairdrops/db";
import { builtinQuizBanks, configJsonSchema, hostedGames, quizBankKind } from "@fairdrops/game-kit";
import { PRISMA, type Database } from "../infra/prisma.module.js";

/** Owns everything FairDrops ships: the built-in games and question banks. Never signs in. */
export const SYSTEM_USER_ID = "00000000-0000-7000-8000-000000000001";

/**
 * Makes sure the games and question banks FairDrops ships are registered, so a giveaway using
 * Dice or Quiz never fails with "Unknown game" because nobody ran a setup script. Only creates
 * what is missing: an admin who disables a built-in game is never overridden.
 */
@Injectable()
export class BuiltinCatalog {
  private readonly logger = new Logger(BuiltinCatalog.name);

  constructor(@Inject(PRISMA) private readonly db: Database) {}

  async sync(now = new Date()): Promise<void> {
    await this.db.user.upsert({
      where: { id: SYSTEM_USER_ID },
      create: { id: SYSTEM_USER_ID, displayName: "FairDrops" },
      update: {},
    });

    const games = await this.db.gameDefinition.createMany({
      data: hostedGames.map((game) => ({
        id: game.id,
        version: game.version,
        name: game.name,
        description: game.description,
        mode: "HOSTED" as const,
        status: "APPROVED" as const,
        configSchema: configJsonSchema(game) as Prisma.InputJsonValue,
        ownerId: SYSTEM_USER_ID,
        reviewedAt: now,
      })),
      skipDuplicates: true,
    });

    const banks = await this.db.gameResource.createMany({
      data: builtinQuizBanks.map(({ bank, hash }) => ({
        hash,
        kind: quizBankKind.kind,
        summary: quizBankKind.summary(bank),
        content: bank,
        createdById: SYSTEM_USER_ID,
      })),
      skipDuplicates: true,
    });

    const released = await this.releaseUnknownGameFailures(now);
    if (games.count || banks.count || released) {
      this.logger.log(
        `Built-in catalog: registered ${games.count} games and ${banks.count} question banks; ` +
          `released ${released} sessions that failed only because their game was unregistered`,
      );
    }
  }

  /**
   * A session that failed at planning because its game wasn't registered yet never committed a
   * seed or admitted a player. While its start is still ahead, deleting it lets the planner plan
   * it again, now that the game exists, instead of leaving a playable giveaway void.
   */
  private async releaseUnknownGameFailures(now: Date): Promise<number> {
    const { count } = await this.db.gameSession.deleteMany({
      where: {
        status: "FAILED",
        failureReason: { startsWith: "Unknown game " },
        seedCommitTx: null,
        // Still ahead; the planner itself refuses a start that has passed.
        startsAt: { gt: now },
        participants: { none: {} },
        actions: { none: {} },
        giveaway: { status: "ACTIVE" },
      },
    });
    return count;
  }
}
