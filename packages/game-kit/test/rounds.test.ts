import type { Address, GiveawayMetadata, Hex } from "@fairdrops/shared";
import { describe, expect, it } from "vitest";
import { configJsonSchema, rounds } from "../src/registry.js";
import { Rng } from "../src/rng.js";
import { sessionGameOf } from "../src/session-game.js";
import { hostedTranscriptSchema, verifyTranscript } from "../src/transcript.js";
import type { RoundsConfig, RoundsState } from "../src/games/rounds.js";
import { ALICE, BOB, CAROL, SEED, START } from "./fixtures.js";

const WINDOW = 30_000;
const BREAK = 5_000;
/** Start of round `r` with 30 s dice rounds and 5 s breaks. */
const roundStart = (r: number) => START + r * (WINDOW + BREAK);

function config(overrides: Partial<RoundsConfig> = {}): RoundsConfig {
  return rounds.config.parse({
    games: [{ id: "dice", version: "1.0.0", config: { rolls: 1, windowSeconds: 30 } }],
    places: 4,
    winnersPerRound: 2,
    // Four 30 s rounds with 5 s breaks.
    playSeconds: 4 * 30 + 3 * 5,
    cooldownSeconds: 5,
    maxWinsPerPlayer: null,
    ...overrides,
  });
}

interface Move {
  player: Address;
  at: number;
  action: unknown;
}

/** Plays moves the way the runtime does and records the transcript. */
function play(value: RoundsConfig, players: Address[], moves: Move[]) {
  const state: RoundsState = rounds.init({
    config: value,
    players,
    startAt: START,
    rng: Rng.fromSeed(SEED),
    resources: new Map<Hex, unknown>(),
  });
  const outcomes = moves.map((move, seq) =>
    rounds.apply(state, rounds.action.parse(move.action), { ...move, seq }),
  );
  const transcript = hostedTranscriptSchema.parse({
    v: 1,
    mode: "HOSTED",
    session: {
      id: "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
      chainId: 84532,
      contract: "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72",
      giveawayId: `0x${"12".repeat(32)}`,
    },
    game: { id: rounds.id, version: rounds.version },
    config: value,
    seed: SEED,
    startAt: START,
    endAt: START + rounds.duration(value),
    players,
    resources: [],
    actions: moves.map((move, seq) => ({ seq, ...move })),
    ranking: rounds.rank(state),
    awards: rounds.awards!(state),
  });
  return { state, outcomes, transcript };
}

const roll = (player: Address, r: number, offset = 1_000): Move => ({
  player,
  at: roundStart(r) + offset,
  action: { type: "roll" },
});

describe("rounds", () => {
  it("awards each round's best players the next places, and replays to the same awards", () => {
    const { transcript } = play(
      config(),
      [ALICE, BOB, CAROL],
      [roll(ALICE, 0), roll(BOB, 0), roll(CAROL, 0), roll(ALICE, 1), roll(BOB, 1)],
    );
    expect(transcript.awards).toHaveLength(4);
    expect(transcript.awards!.map((award) => award.round)).toEqual([0, 0, 1, 1]);
    expect(verifyTranscript(transcript)).toEqual({ ok: true });
  });

  it("lets a player win again, up to the per-person limit", () => {
    const moves = [0, 1, 2, 3].flatMap((r) => [roll(ALICE, r), roll(BOB, r)]);
    const unlimited = play(config(), [ALICE, BOB], moves).transcript.awards!;
    expect(unlimited.filter((award) => award.player === ALICE)).toHaveLength(2);

    const capped = play(config({ places: 4, maxWinsPerPlayer: 1 }), [ALICE, BOB], moves);
    const counts = capped.transcript.awards!.reduce<Record<string, number>>(
      (all, award) => ({ ...all, [award.player]: (all[award.player] ?? 0) + 1 }),
      {},
    );
    expect(Object.values(counts).every((n) => n <= 1)).toBe(true);
    // Two players at one win each: two of the four places stay unwon.
    expect(capped.transcript.awards).toHaveLength(2);
  });

  it("carries unfilled places to the next round and is decided when the last one is won", () => {
    const { state, transcript } = play(
      config({ places: 3 }),
      [ALICE, BOB],
      [roll(ALICE, 0), roll(ALICE, 1), roll(BOB, 1)],
    );
    // Round 0: only Alice scored, so one place carries over; round 1 fills the other two.
    expect(transcript.awards!.map((award) => award.round)).toEqual([0, 1, 1]);
    const end = roundStart(1) + WINDOW;
    expect(rounds.decidedAt!(state, end - 1)).toBeNull();
    expect(rounds.decidedAt!(state, end)).toBe(end);
    expect(rounds.publicView(state, end + 60_000).phase).toBe("over");
  });

  it("puts people who join between rounds into the next round only", () => {
    const { outcomes, transcript } = play(
      config(),
      [ALICE],
      [
        roll(ALICE, 0),
        { player: BOB, at: roundStart(0) + 2_000, action: { roster: "join" } },
        roll(BOB, 0, 3_000),
        roll(BOB, 1),
        { player: ALICE, at: roundStart(1) + WINDOW + 1_000, action: { roster: "leave" } },
        roll(ALICE, 2),
      ],
    );
    expect(outcomes.map((outcome) => outcome.accepted)).toEqual([
      true,
      true,
      false,
      true,
      true,
      false,
    ]);
    expect(transcript.awards!.some((award) => award.player === BOB && award.round === 1)).toBe(
      true,
    );
    expect(verifyTranscript(transcript)).toEqual({ ok: true });
  });

  it("rejects play during a break", () => {
    const { outcomes } = play(
      config(),
      [ALICE],
      [{ player: ALICE, at: roundStart(0) + WINDOW + 1_000, action: { type: "roll" } }],
    );
    expect(outcomes[0]).toEqual({ accepted: false, reason: "Between rounds" });
  });

  it("is what a giveaway with rounds runs, and has a registrable config schema", () => {
    const metadata: GiveawayMetadata = {
      v: 2,
      title: "Rounds",
      description: "",
      game: { id: "dice", version: "1.0.0", config: {} },
      rewards: { kind: "equal", winners: 6, minScore: 1 },
      rounds: {
        winnersPerRound: 2,
        playSeconds: 600,
        cooldownSeconds: 10,
        maxWinsPerPlayer: 3,
        next: [],
      },
    };
    const game = sessionGameOf(metadata, 6);
    expect(game.id).toBe("rounds");
    expect(rounds.config.parse(game.config)).toMatchObject({ places: 6, maxWinsPerPlayer: 3 });
    expect(configJsonSchema(rounds as never)).toHaveProperty("properties");
  });

  it("plays only the rounds that end within the play time", () => {
    const state = rounds.init({
      config: config({ playSeconds: 4 * 30 + 3 * 5 - 1 }),
      players: [ALICE],
      startAt: START,
      rng: Rng.fromSeed(SEED),
      resources: new Map<Hex, unknown>(),
    });
    expect(state.schedule).toHaveLength(3);
    expect(rounds.publicView(state, START).maxRounds).toBe(3);
  });

  it("rejects a play time shorter than one round", () => {
    expect(() => config({ playSeconds: 20 })).toThrow(/shorter than one round/);
  });
});
