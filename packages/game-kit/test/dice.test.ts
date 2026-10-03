import { describe, expect, it } from "vitest";
import { dice, type DiceState } from "../src/games/dice.js";
import { Rng } from "../src/rng.js";
import { ALICE, BOB, CAROL, SEED, START } from "./fixtures.js";

const config = dice.config.parse({});
const roll = { type: "roll" } as const;

function start(): DiceState {
  return dice.init({
    config,
    players: [ALICE, BOB, CAROL],
    startAt: START,
    rng: Rng.fromSeed(SEED),
    resources: new Map(),
  });
}

describe("dice", () => {
  it("applies defaults", () => {
    expect(config).toEqual({ rolls: 3, dice: 2, sides: 6, windowSeconds: 20 });
    expect(dice.duration(config)).toBe(20_000);
  });

  it("gives each player the same rolls whatever order everyone rolls in", () => {
    const a = start();
    dice.apply(a, roll, { player: ALICE, seq: 0, at: START + 1 });
    dice.apply(a, roll, { player: BOB, seq: 1, at: START + 2 });
    dice.apply(a, roll, { player: ALICE, seq: 2, at: START + 3 });

    const b = start();
    dice.apply(b, roll, { player: BOB, seq: 0, at: START + 5_000 });
    dice.apply(b, roll, { player: ALICE, seq: 1, at: START + 6_000 });
    dice.apply(b, roll, { player: ALICE, seq: 2, at: START + 7_000 });

    expect(dice.playerView(a, ALICE, START)).toEqual(dice.playerView(b, ALICE, START));
    expect(dice.playerView(a, BOB, START)).toEqual(dice.playerView(b, BOB, START));
    const view = dice.playerView(a, ALICE, START);
    expect(view.rolls).toHaveLength(2);
    expect(view.remaining).toBe(1);
    for (const values of view.rolls) {
      expect(values).toHaveLength(2);
      for (const value of values) expect(value >= 1 && value <= 6).toBe(true);
    }
  });

  it("limits rolls to the count and the window", () => {
    const state = start();
    expect(dice.apply(state, roll, { player: ALICE, seq: 0, at: START - 1 })).toEqual({
      accepted: false,
      reason: "The game has not started",
    });
    for (let i = 0; i < 3; i++) {
      expect(dice.apply(state, roll, { player: ALICE, seq: i, at: START + i })).toEqual({
        accepted: true,
      });
    }
    expect(dice.apply(state, roll, { player: ALICE, seq: 3, at: START + 10 })).toEqual({
      accepted: false,
      reason: "No rolls left",
    });
    expect(dice.apply(state, roll, { player: BOB, seq: 4, at: START + 20_000 })).toEqual({
      accepted: false,
      reason: "The game is over",
    });
  });

  it("ranks by total with every tie broken, including players who never rolled", () => {
    const state = start();
    for (let i = 0; i < 3; i++) dice.apply(state, roll, { player: ALICE, seq: i, at: START + i });
    dice.apply(state, roll, { player: BOB, seq: 3, at: START + 5 });

    const ranking = dice.rank(state);
    expect(ranking.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(ranking.at(-1)).toEqual({ player: CAROL, score: 0, rank: 3 });
    const aliceTotal = dice.playerView(state, ALICE, START).total;
    expect(ranking.find((s) => s.player === ALICE)!.score).toBe(aliceTotal);
    expect(dice.rank(state)).toEqual(ranking);
  });

  it("publishes a leaderboard but not other players' rolls", () => {
    const state = start();
    dice.apply(state, roll, { player: ALICE, seq: 0, at: START + 1 });
    expect(dice.publicView(state, START - 1)).toEqual({ phase: "waiting", startsAt: START });
    const view = dice.publicView(state, START + 10);
    expect(view).toMatchObject({ phase: "rolling", rolledPlayers: 1, endsAt: START + 20_000 });
    expect(JSON.stringify(view)).not.toContain("rolls");
  });
});
