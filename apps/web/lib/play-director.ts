/** Ordered dice and quiz slots. The same game may appear more than once. Tap is not a slot. */
export const PLAYABLE_GAMES = ["dice", "quiz"] as const;
export type PlayableGameId = (typeof PLAYABLE_GAMES)[number];

export interface GameSlot {
  id: PlayableGameId;
}

export type PlayBeat =
  | { type: "lobby" }
  | { type: "next"; slot: number }
  | { type: "play"; slot: number }
  | { type: "settling" }
  | { type: "results" };

export type LineupSessionStatus =
  | "SCHEDULED"
  | "SEED_COMMITTED"
  | "LOBBY"
  | "RUNNING"
  | "SETTLING"
  | "FINALIZING"
  | "FINALIZED"
  | "CANCELLED"
  | "FAILED";

export type PlayEvent =
  | { type: "status"; status: LineupSessionStatus }
  | { type: "slot-finished" }
  | { type: "countdown-done" };

export class UnsupportedGameError extends Error {
  constructor(readonly id: string) {
    super(`Unsupported game: ${id}`);
    this.name = "UnsupportedGameError";
  }
}

const EARLY_END = new Set<LineupSessionStatus>(["SETTLING", "FINALIZING"]);

export function parseLineup(ids: readonly string[]): GameSlot[] {
  if (ids.length === 0) throw new UnsupportedGameError("(empty)");
  return ids.map((id) => {
    if (id !== "dice" && id !== "quiz") throw new UnsupportedGameError(id);
    return { id };
  });
}

/** Today's sessions name one game. A later games array only changes this mapper. */
export function lineupFromSession(gameId: string): GameSlot[] {
  return parseLineup([gameId]);
}

export function initialBeat(): PlayBeat {
  return { type: "lobby" };
}

/**
 * The only place a stage changes. Game screens report that a slot finished;
 * they do not choose the next screen. Settling starts after the last slot,
 * or earlier when the session itself is already counting results.
 */
export function reducePlay(
  beat: PlayBeat,
  lineup: readonly GameSlot[],
  event: PlayEvent,
): PlayBeat {
  switch (event.type) {
    case "status":
      return reduceStatus(beat, lineup, event.status);
    case "countdown-done":
      if (beat.type !== "next") return beat;
      return { type: "play", slot: beat.slot };
    case "slot-finished": {
      if (beat.type !== "play") return beat;
      const next = beat.slot + 1;
      if (next < lineup.length) return { type: "next", slot: next };
      return { type: "settling" };
    }
    default: {
      const neverEvent: never = event;
      return neverEvent;
    }
  }
}

function reduceStatus(
  beat: PlayBeat,
  lineup: readonly GameSlot[],
  status: LineupSessionStatus,
): PlayBeat {
  if (status === "FINALIZED") return { type: "results" };
  if (EARLY_END.has(status)) return beat.type === "results" ? beat : { type: "settling" };
  if (status === "RUNNING" && beat.type === "lobby" && lineup.length > 0) {
    return { type: "play", slot: 0 };
  }
  return beat;
}

export function gameTitle(id: PlayableGameId): string {
  switch (id) {
    case "dice":
      return "Dice";
    case "quiz":
      return "Quiz";
    default: {
      const neverId: never = id;
      return neverId;
    }
  }
}

export function gameHowTo(id: PlayableGameId): string {
  switch (id) {
    case "dice":
      return "Roll three times. Your total across all rolls counts.";
    case "quiz":
      return "Faster right answers score more.";
    default: {
      const neverId: never = id;
      return neverId;
    }
  }
}
