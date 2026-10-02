import { Inject, Injectable } from "@nestjs/common";
import type { GameSession, SessionStatus } from "@fairdrops/db";
import { ROUNDS_GAME_ID, hashJson } from "@fairdrops/game-kit";
import {
  ENDED_SESSION_STATUSES,
  JOINABLE_SESSION_STATUSES,
  SCORE_REPORT_DOMAIN,
  SCORE_REPORT_TYPES,
  type Address,
  type ApiKeyIdentity,
  type Hex,
  type Page,
  type PaginationQuery,
  type ParticipantView,
  type ScoreReportRequest,
  type SessionView,
  type StandingView,
} from "@fairdrops/shared";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { verifyTypedData } from "viem";
import type { AuthContext } from "../auth/auth.types.js";
import { AppException } from "../common/app.exception.js";
import { isUniqueViolation } from "../common/prisma-errors.js";
import { API_ENV, type ApiEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { REDIS } from "../infra/redis.module.js";
import { appendAction } from "./action-stream.js";

const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;
const JOINABLE: SessionStatus[] = [...JOINABLE_SESSION_STATUSES];
const ENDED: SessionStatus[] = [...ENDED_SESSION_STATUSES];

function toView(session: GameSession, playerCount: number): SessionView {
  // The result is public once the game is over, including when settling it then failed.
  const ended = ENDED.includes(session.status) || session.seed !== null;
  return {
    id: session.id,
    chainId: session.chainId,
    giveawayId: session.giveawayId as Hex,
    game: { id: session.gameId, version: session.gameVersion, mode: session.mode },
    status: session.status,
    failureReason: session.failureReason,
    config: session.config as Record<string, unknown>,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    playerCount,
    seedCommitment: session.seedCommitment as Hex,
    seed: ended ? (session.seed as Hex) : null,
    ranking: ended ? (session.ranking as StandingView[]) : null,
    transcriptHash: ended ? (session.transcriptHash as Hex) : null,
  };
}

@Injectable()
export class SessionsService {
  constructor(
    @Inject(PRISMA) private readonly db: Database,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async get(id: string): Promise<SessionView> {
    const session = await this.db.gameSession.findUnique({ where: { id } });
    if (!session) throw AppException.notFound("No such session");
    return toView(session, await this.playerCount(id));
  }

  async byGiveaway(chainId: number, giveawayId: Hex): Promise<SessionView> {
    const session = await this.db.gameSession.findUnique({
      where: { chainId_giveawayId: { chainId, giveawayId } },
    });
    if (!session) throw AppException.notFound("This giveaway has no session yet");
    return toView(session, await this.playerCount(session.id));
  }

  async participants(id: string, query: PaginationQuery): Promise<Page<ParticipantView>> {
    await this.get(id);
    const rows = await this.db.sessionParticipant.findMany({
      where: { sessionId: id, ...(query.cursor ? { wallet: { gt: query.cursor } } : {}) },
      orderBy: { wallet: "asc" },
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit).map((row) => ({
      wallet: row.wallet as Address,
      joinedAt: row.joinedAt.toISOString(),
    }));
    return {
      items,
      nextCursor: rows.length > query.limit ? (items.at(-1)?.wallet ?? null) : null,
    };
  }

  /**
   * Adds the signed-in wallet to a session before it starts. The session row is share-locked
   * for the check and the insert; the worker locks it exclusively to start the game, so a join
   * either lands before the start or is refused, never in between.
   *
   * A game played in rounds can also be joined while it runs: the join is then logged as an
   * action, and the player is in every round that starts after it. Joining again after leaving
   * works the same way.
   */
  async join(auth: AuthContext, id: string): Promise<ParticipantView> {
    let running = false;
    const participant = await this.db.$transaction(async (tx) => {
      const [session] = await tx.$queryRaw<
        {
          status: SessionStatus;
          starts_at: Date;
          chain_id: number;
          giveaway_id: string;
          game_id: string;
        }[]
      >`SELECT status, starts_at, chain_id, giveaway_id, game_id FROM game_sessions
        WHERE id = ${id}::uuid FOR SHARE`;
      if (!session) throw AppException.notFound("No such session");
      running = session.status === "RUNNING" && session.game_id === ROUNDS_GAME_ID;
      const beforeStart =
        JOINABLE.includes(session.status) && session.starts_at.getTime() > Date.now();
      if (!beforeStart && !running) {
        throw AppException.conflict(`This game can no longer be joined (${session.status})`);
      }

      const giveaway = await tx.giveaway.findUniqueOrThrow({
        where: {
          chainId_giveawayId: { chainId: session.chain_id, giveawayId: session.giveaway_id },
        },
        select: { host: true },
      });
      if (giveaway.host === auth.wallet) {
        throw AppException.forbidden("Hosts cannot play in their own giveaway");
      }

      const existing = await tx.sessionParticipant.findUnique({
        where: { sessionId_wallet: { sessionId: id, wallet: auth.wallet } },
      });
      if (existing) return existing;

      // A soft cap: concurrent joins can pass it by a few, which is harmless.
      const count = await tx.sessionParticipant.count({ where: { sessionId: id } });
      if (count >= this.env.SESSION_MAX_PLAYERS) throw AppException.conflict("This game is full");

      return tx.sessionParticipant.create({
        data: { sessionId: id, wallet: auth.wallet, userId: auth.userId },
      });
    });
    if (running) {
      await appendAction(this.redis, id, auth.wallet, `join-${randomUUID()}`, { roster: "join" });
    }
    return { wallet: participant.wallet as Address, joinedAt: participant.joinedAt.toISOString() };
  }

  /** The published record of a finished game, exactly as its hash was computed. */
  async transcript(id: string): Promise<unknown> {
    const transcript = await this.db.sessionTranscript.findUnique({ where: { sessionId: id } });
    if (transcript) return transcript.content;
    await this.get(id);
    throw AppException.conflict("The transcript is published when the game is over");
  }

  /**
   * Accepts an external game's result. The API key must belong to the game's developer, and
   * the report must be signed by the game's registered reporter key. The worker settles the
   * session from it on its next pass.
   */
  async report(apiKey: ApiKeyIdentity, id: string, body: ScoreReportRequest): Promise<SessionView> {
    const session = await this.db.gameSession.findUnique({ where: { id } });
    if (!session) throw AppException.notFound("No such session");
    if (session.mode !== "EXTERNAL") {
      throw AppException.conflict(
        "Only external games report scores; FairDrops scores hosted games",
      );
    }
    const definition = await this.db.gameDefinition.findUniqueOrThrow({
      where: { id_version: { id: session.gameId, version: session.gameVersion } },
      select: { ownerId: true, reporterAddress: true },
    });
    if (definition.ownerId !== apiKey.ownerId) {
      throw AppException.forbidden("This API key does not belong to the game's developer");
    }
    if (session.status !== "RUNNING") {
      throw AppException.conflict(
        `Scores can only be reported while the game runs (${session.status})`,
      );
    }
    if (session.endsAt.getTime() <= Date.now()) {
      throw AppException.conflict("The deadline for this report has passed");
    }

    const participants = new Set(
      (
        await this.db.sessionParticipant.findMany({
          where: { sessionId: id },
          select: { wallet: true },
        })
      ).map((p) => p.wallet),
    );
    const outsiders = body.ranking.filter((entry) => !participants.has(entry.player));
    if (outsiders.length > 0) {
      throw new AppException(
        "VALIDATION_FAILED",
        `Not players in this session: ${outsiders.map((o) => o.player).join(", ")}`,
      );
    }

    const valid = await verifyTypedData({
      address: definition.reporterAddress as Address,
      domain: SCORE_REPORT_DOMAIN,
      types: SCORE_REPORT_TYPES,
      primaryType: "ScoreReport",
      message: {
        sessionId: id,
        chainId: BigInt(session.chainId),
        giveawayId: session.giveawayId as Hex,
        rankingHash: hashJson(body.ranking),
        gameTranscriptHash: body.gameTranscriptHash ?? ZERO_HASH,
      },
      signature: body.signature,
    }).catch(() => false);
    if (!valid) {
      throw new AppException(
        "VALIDATION_FAILED",
        "The report is not signed by the game's reporter key",
      );
    }

    try {
      await this.db.scoreReport.create({
        data: {
          sessionId: id,
          reporter: definition.reporterAddress!,
          apiKeyId: apiKey.keyId,
          ranking: body.ranking,
          gameTranscriptHash: body.gameTranscriptHash,
          signature: body.signature,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict("Scores were already reported");
      throw error;
    }
    return this.get(id);
  }

  private playerCount(sessionId: string): Promise<number> {
    return this.db.sessionParticipant.count({ where: { sessionId } });
  }
}
