import { Inject, Injectable, Logger } from "@nestjs/common";
import type { GameSession, Prisma, SessionStatus } from "@fairdrops/db";
import {
  externalTranscriptSchema,
  transcriptHash,
  type ExternalTranscript,
  type Transcript,
} from "@fairdrops/game-kit";
import {
  JOINABLE_SESSION_STATUSES,
  type Address,
  type Hex,
  type StandingView,
} from "@fairdrops/shared";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { SeedVault } from "./seed-vault.js";
import { SessionBus } from "./session-bus.js";

const PRE_START: SessionStatus[] = [...JOINABLE_SESSION_STATUSES];

/** Statuses a session never leaves on its own. */
export const TERMINAL_STATUSES: SessionStatus[] = ["FINALIZED", "CANCELLED", "FAILED"];

/**
 * Moves sessions between statuses. Every change is conditional on the status it starts from, so
 * a planner tick, a queued job and a runtime that race over the same session cannot both apply
 * a change: the loser updates no rows and does nothing.
 */
@Injectable()
export class SessionLifecycle {
  private readonly logger = new Logger(SessionLifecycle.name);

  constructor(
    @Inject(PRISMA) private readonly db: Database,
    private readonly bus: SessionBus,
    private readonly vault: SeedVault,
  ) {}

  /** Records a seed commitment confirmed on-chain. */
  async seedCommitted(sessionId: string, txHash: Hex | null): Promise<boolean> {
    return this.move(sessionId, ["SCHEDULED"], "SEED_COMMITTED", { seedCommitTx: txHash });
  }

  async openLobby(sessionId: string): Promise<boolean> {
    return this.move(sessionId, ["SEED_COMMITTED"], "LOBBY");
  }

  async fail(sessionId: string, from: SessionStatus[], reason: string): Promise<boolean> {
    return this.move(sessionId, from, "FAILED", { failureReason: reason });
  }

  async cancel(sessionId: string, from: SessionStatus[], reason: string): Promise<boolean> {
    return this.move(sessionId, from, "CANCELLED", { failureReason: reason });
  }

  /** The finalize transaction for the session's result was broadcast. */
  async finalizing(sessionId: string): Promise<boolean> {
    return this.move(sessionId, ["SETTLING"], "FINALIZING");
  }

  /** The chain recorded the session's result; winners can claim. */
  async finalized(sessionId: string): Promise<boolean> {
    return this.move(sessionId, ["SETTLING", "FINALIZING"], "FINALIZED");
  }

  /**
   * Starts play at the scheduled time. The session row is locked for the decision, and joining
   * takes a share lock on it, so no one can join between counting the players and starting.
   */
  async start(sessionId: string, now = new Date()): Promise<SessionStatus | null> {
    const outcome = await this.db.$transaction(async (tx) => {
      const [session] = await tx.$queryRaw<
        { status: SessionStatus; starts_at: Date; chain_id: number; giveaway_id: string }[]
      >`SELECT status, starts_at, chain_id, giveaway_id FROM game_sessions
        WHERE id = ${sessionId}::uuid FOR UPDATE`;
      if (!session || !PRE_START.includes(session.status)) return null;
      if (session.starts_at.getTime() > now.getTime()) return null;

      const giveaway = await tx.giveaway.findUniqueOrThrow({
        where: {
          chainId_giveawayId: { chainId: session.chain_id, giveawayId: session.giveaway_id },
        },
        select: { status: true },
      });
      const players = await tx.sessionParticipant.count({ where: { sessionId } });

      let next: { status: SessionStatus; data: Prisma.GameSessionUpdateManyMutationInput };
      if (giveaway.status !== "ACTIVE") {
        next = {
          status: "CANCELLED",
          data: { failureReason: `The giveaway is ${giveaway.status.toLowerCase()} on-chain` },
        };
      } else if (session.status === "SCHEDULED") {
        next = {
          status: "FAILED",
          data: { failureReason: "The seed was not committed on-chain before the start" },
        };
      } else if (players === 0) {
        next = { status: "CANCELLED", data: { failureReason: "Nobody joined" } };
      } else {
        next = { status: "RUNNING", data: { startedAt: now } };
      }

      const { count } = await tx.gameSession.updateMany({
        where: { id: sessionId, status: session.status },
        data: { status: next.status, ...next.data },
      });
      return count === 1 ? next.status : null;
    });

    if (outcome) {
      this.logger.log(`Session ${sessionId}: ${outcome}`);
      await this.bus.status(sessionId, outcome);
    }
    return outcome;
  }

  /**
   * Settles an external game from its signed report: the ranks are the reported order. The
   * report was checked when the API accepted it.
   */
  async settleExternal(sessionId: string, now = new Date()): Promise<boolean> {
    const session = await this.db.gameSession.findUnique({
      where: { id: sessionId },
      include: { scoreReport: true, giveaway: { select: { contractAddress: true } } },
    });
    if (!session?.scoreReport || session.status !== "RUNNING" || session.mode !== "EXTERNAL") {
      return false;
    }

    const report = session.scoreReport;
    const reported = report.ranking as { player: Address; score: number }[];
    const ranking: StandingView[] = reported.map((entry, i) => ({ ...entry, rank: i + 1 }));
    const seed = this.vault.decrypt(session.seedCiphertext);
    const players = await this.players(sessionId);

    const transcript: ExternalTranscript = externalTranscriptSchema.parse({
      v: 1,
      mode: "EXTERNAL",
      session: {
        id: session.id,
        chainId: session.chainId,
        contract: session.giveaway.contractAddress,
        giveawayId: session.giveawayId,
      },
      game: { id: session.gameId, version: session.gameVersion },
      config: session.config,
      seed,
      startAt: session.startsAt.getTime(),
      endAt: report.receivedAt.getTime(),
      players,
      ranking,
      report: {
        reporter: report.reporter,
        signature: report.signature,
        gameTranscriptHash: report.gameTranscriptHash,
        receivedAt: report.receivedAt.getTime(),
      },
    });

    return this.settle(session, { transcript, ranking, seed, endedAt: now });
  }

  /** Records the result of a finished game, unless something else moved the session first. */
  async settle(
    session: Pick<GameSession, "id" | "lastStreamId">,
    result: { transcript: Transcript; ranking: StandingView[]; seed: Hex; endedAt: Date },
  ): Promise<boolean> {
    const hash = transcriptHash(result.transcript);
    const settled = await this.db.$transaction(async (tx) => {
      const { count } = await tx.gameSession.updateMany({
        where: { id: session.id, status: "RUNNING", lastStreamId: session.lastStreamId },
        data: {
          status: "SETTLING",
          ranking: result.ranking,
          transcriptHash: hash,
          seed: result.seed,
          endedAt: result.endedAt,
        },
      });
      if (count !== 1) return false;
      await tx.sessionTranscript.create({
        data: {
          sessionId: session.id,
          hash,
          content: result.transcript as Prisma.InputJsonValue,
        },
      });
      return true;
    });

    if (settled) {
      this.logger.log(`Session ${session.id}: SETTLING (transcript ${hash})`);
      await this.bus.status(session.id, "SETTLING", result.ranking);
    }
    return settled;
  }

  /** Players in the order transcripts list them: lowercase and sorted. */
  async players(sessionId: string): Promise<Address[]> {
    const rows = await this.db.sessionParticipant.findMany({
      where: { sessionId },
      select: { wallet: true },
    });
    // Sorted here rather than by the database, whose order depends on its collation.
    return rows.map((row) => row.wallet as Address).sort();
  }

  private async move(
    sessionId: string,
    from: SessionStatus[],
    to: SessionStatus,
    data: { failureReason?: string; seedCommitTx?: Hex | null } = {},
  ): Promise<boolean> {
    const { count } = await this.db.gameSession.updateMany({
      where: { id: sessionId, status: { in: from } },
      data: { ...data, status: to },
    });
    if (count === 1) {
      const reason = data.failureReason ? ` (${data.failureReason})` : "";
      this.logger.log(`Session ${sessionId}: ${to}${reason}`);
      await this.bus.status(sessionId, to);
    }
    return count === 1;
  }
}
