import { sessionKeys, type Address } from "@fairdrops/shared";
import type { Redis } from "ioredis";

/** Bounds a session's action stream; the runtime logs entries long before this many pile up. */
const STREAM_MAX_LENGTH = 200_000;

/**
 * Appends a player's action to the session's stream, where the runtime sequences and logs it.
 * `id` is the client's id for the action; the runtime ignores a repeat of the same one.
 */
export async function appendAction(
  redis: Redis,
  sessionId: string,
  player: Address,
  id: string,
  action: unknown,
): Promise<void> {
  await redis.xadd(
    sessionKeys.actions(sessionId),
    "MAXLEN",
    "~",
    STREAM_MAX_LENGTH,
    "*",
    "player",
    player,
    "id",
    id,
    "action",
    JSON.stringify(action),
  );
}
