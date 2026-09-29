import { Inject, Injectable } from "@nestjs/common";
import {
  sessionKeys,
  type ActionResult,
  type Address,
  type SessionEvent,
  type SessionStatus,
  type StandingView,
} from "@fairdrops/shared";
import { Redis } from "ioredis";
import { REDIS } from "../infra/redis.module.js";

/** How long views stay readable after a game ends, for late page loads. */
const ENDED_VIEW_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface PlayerUpdate {
  player: Address;
  view: unknown;
  result?: ActionResult;
}

/**
 * Publishes session state for the API gateways. Latest views are stored as well as published,
 * so a player who connects mid-game gets a snapshot without waiting for the next change.
 */
@Injectable()
export class SessionBus {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async status(sessionId: string, status: SessionStatus, ranking?: StandingView[]): Promise<void> {
    await this.publish(sessionId, { kind: "status", status, ranking });
  }

  async publicView(sessionId: string, view: unknown): Promise<void> {
    const event: SessionEvent = { kind: "public", view };
    await this.redis
      .multi()
      .set(sessionKeys.publicView(sessionId), JSON.stringify(view))
      .publish(sessionKeys.events(sessionId), JSON.stringify(event))
      .exec();
  }

  async players(sessionId: string, updates: PlayerUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const update of updates) {
      const event: SessionEvent = { kind: "player", ...update };
      pipeline.hset(sessionKeys.playerViews(sessionId), update.player, JSON.stringify(update.view));
      pipeline.publish(sessionKeys.events(sessionId), JSON.stringify(event));
    }
    await pipeline.exec();
  }

  /** Lets a finished game's views expire and drops its action stream, which is now in Postgres. */
  async retire(sessionId: string): Promise<void> {
    await this.redis
      .multi()
      .expire(sessionKeys.publicView(sessionId), ENDED_VIEW_TTL_SECONDS)
      .expire(sessionKeys.playerViews(sessionId), ENDED_VIEW_TTL_SECONDS)
      .del(sessionKeys.actions(sessionId))
      .exec();
  }

  private async publish(sessionId: string, event: SessionEvent): Promise<void> {
    await this.redis.publish(sessionKeys.events(sessionId), JSON.stringify(event));
  }
}
