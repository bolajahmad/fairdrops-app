import { describe, expect, it } from "vitest";
import {
  lineupFromSession,
  parseLineup,
  reducePlay,
  UnsupportedGameError,
  type PlayBeat,
} from "./play-director";

describe("parseLineup", () => {
  it("rejects tap so it never becomes a beat", () => {
    expect(() => parseLineup(["tap"])).toThrow(UnsupportedGameError);
    expect(() => parseLineup(["dice", "tap"])).toThrow(UnsupportedGameError);
  });

  it("keeps repeated games as separate slots", () => {
    expect(parseLineup(["dice", "quiz", "dice"])).toEqual([
      { id: "dice" },
      { id: "quiz" },
      { id: "dice" },
    ]);
  });
});

describe("reducePlay", () => {
  it("goes from dice to the quiz interstitial, not settling", () => {
    const lineup = parseLineup(["dice", "quiz"]);
    const next = reducePlay({ type: "play", slot: 0 }, lineup, { type: "slot-finished" });
    expect(next).toEqual({ type: "next", slot: 1 });
    expect(lineup[1]?.id).toBe("quiz");
    expect(reducePlay(next, lineup, { type: "countdown-done" })).toEqual({
      type: "play",
      slot: 1,
    });
  });

  it("goes from a lone quiz to settling", () => {
    const lineup = parseLineup(["quiz"]);
    expect(reducePlay({ type: "play", slot: 0 }, lineup, { type: "slot-finished" })).toEqual({
      type: "settling",
    });
  });

  it("alternates and treats the second dice as a new slot", () => {
    const lineup = parseLineup(["dice", "quiz", "dice"]);
    let beat: PlayBeat = { type: "play", slot: 0 };
    beat = reducePlay(beat, lineup, { type: "slot-finished" });
    expect(beat).toEqual({ type: "next", slot: 1 });
    beat = reducePlay(beat, lineup, { type: "countdown-done" });
    beat = reducePlay(beat, lineup, { type: "slot-finished" });
    expect(beat).toEqual({ type: "next", slot: 2 });
    expect(lineup[beat.type === "next" ? beat.slot : -1]).toEqual({ id: "dice" });
    beat = reducePlay(beat, lineup, { type: "countdown-done" });
    expect(beat).toEqual({ type: "play", slot: 2 });
    expect(beat).not.toEqual({ type: "play", slot: 0 });
  });

  it("ends the lineup early when the session is settling", () => {
    const lineup = parseLineup(["dice", "quiz"]);
    expect(
      reducePlay({ type: "play", slot: 0 }, lineup, { type: "status", status: "SETTLING" }),
    ).toEqual({ type: "settling" });
  });

  it("maps a live session game to one slot", () => {
    expect(lineupFromSession("dice")).toEqual([{ id: "dice" }]);
    expect(() => lineupFromSession("tap")).toThrow(UnsupportedGameError);
  });
});
