import {
  Rng,
  dice,
  externalTranscriptSchema,
  hashJson,
  hostedTranscriptSchema,
  transcriptHash,
  type ExternalTranscript,
  type HostedTranscript,
} from "@fairdrops/game-kit";
import {
  SCORE_REPORT_DOMAIN,
  SCORE_REPORT_TYPES,
  giveawayMetadataSchema,
  type Address,
  type GiveawayMetadata,
  type Hex,
} from "@fairdrops/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { computeSettlement, settlementMessage } from "../src/settlement.js";
import { seedCommitment } from "../src/typed-data.js";
import { verifySettlement, type VerifySettlementInput } from "../src/verify.js";

const CHAIN_ID = 84532;
const CONTRACT = "0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca" as Address;
const GIVEAWAY: Hex = `0x${"12".repeat(32)}`;
const SEED: Hex = `0x${"5e".repeat(32)}`;
const START = 1_790_000_000_000;
const PLAYERS = [
  "0x00000000000000000000000000000000000000a1",
  "0x00000000000000000000000000000000000000b2",
  "0x00000000000000000000000000000000000000c3",
] as Address[];
const PRIZE = 1_000_000n;

const metadata: GiveawayMetadata = giveawayMetadataSchema.parse({
  v: 2,
  title: "Dice night",
  description: "",
  game: { id: "dice", version: "1.0.0", config: { rolls: 2, windowSeconds: 60 } },
  rewards: { kind: "weighted", bps: [7000, 3000] },
});

/** Plays dice the way the runtime does: every player rolls twice. */
function playDice(): HostedTranscript {
  const config = dice.config.parse(metadata.game.config);
  const state = dice.init({
    config,
    players: PLAYERS,
    startAt: START,
    rng: Rng.fromSeed(SEED),
    resources: new Map(),
  });
  const actions = PLAYERS.flatMap((player, p) =>
    [0, 1].map((r) => ({ player, at: START + 1_000 * (p * 2 + r + 1), action: { type: "roll" } })),
  );
  const logged = actions.map((entry, seq) => {
    dice.apply(state, { type: "roll" }, { player: entry.player, seq, at: entry.at });
    return { seq, ...entry };
  });
  return hostedTranscriptSchema.parse({
    v: 1,
    mode: "HOSTED",
    session: {
      id: "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
      chainId: CHAIN_ID,
      contract: CONTRACT,
      giveawayId: GIVEAWAY,
    },
    game: { id: "dice", version: "1.0.0" },
    config,
    seed: SEED,
    startAt: START,
    endAt: START + dice.duration(config),
    players: PLAYERS,
    resources: [],
    actions: logged,
    ranking: dice.rank(state),
  });
}

function inputFor(
  transcript: unknown,
  overrides: Partial<VerifySettlementInput> = {},
): VerifySettlementInput {
  const parsed = hostedTranscriptSchema.or(externalTranscriptSchema).parse(transcript);
  const computed = computeSettlement({
    giveawayId: GIVEAWAY,
    ranking: parsed.ranking,
    policy: { kind: "weighted", bps: [7000, 3000], minScore: 1 },
    prize: PRIZE,
  })!;
  return {
    chainId: CHAIN_ID,
    contract: CONTRACT,
    giveawayId: GIVEAWAY,
    giveaway: { prize: PRIZE, maxWinners: 3, seedCommitment: seedCommitment(GIVEAWAY, SEED) },
    metadata,
    transcript,
    settlement: settlementMessage(GIVEAWAY, computed, SEED, transcriptHash(parsed)),
    ...overrides,
  };
}

const failed = async (input: VerifySettlementInput) =>
  (await verifySettlement(input)).checks.filter((c) => !c.ok).map((c) => c.name);

describe("verifySettlement, hosted game", () => {
  it("accepts an honest settlement and recomputes its payouts", async () => {
    const transcript = playDice();
    const result = await verifySettlement(inputFor(transcript));
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.computed!.winnerCount).toBe(2);
    expect(result.computed!.payouts.map((p) => p.account)).toEqual(
      transcript.ranking.slice(0, 2).map((r) => r.player),
    );
    expect(result.computed!.totalPayout).toBe(1_000_000n);
  });

  it("rejects a transcript whose actions were changed", async () => {
    const transcript = playDice();
    const honest = inputFor(transcript);
    transcript.actions[0]!.at += 1;
    transcript.actions.pop();
    expect(await failed({ ...honest, transcript })).toEqual(
      expect.arrayContaining(["result", "transcriptHash"]),
    );
  });

  it("rejects a seed that was not committed before the start", async () => {
    const other: Hex = `0x${"77".repeat(32)}`;
    const input = inputFor(playDice(), {
      giveaway: { prize: PRIZE, maxWinners: 3, seedCommitment: seedCommitment(GIVEAWAY, other) },
    });
    expect(await failed(input)).toEqual(["seed"]);
  });

  it("rejects payouts that do not follow the host's policy", async () => {
    const input = inputFor(playDice());
    const equalSplit = computeSettlement({
      giveawayId: GIVEAWAY,
      ranking: playDice().ranking,
      policy: { kind: "equal", winners: 2, minScore: 1 },
      prize: PRIZE,
    })!;
    input.settlement = { ...input.settlement, payoutRoot: equalSplit.payoutRoot };
    expect(await failed(input)).toEqual(["payouts"]);
    input.settlement = { ...inputFor(playDice()).settlement, totalPayout: PRIZE + 1n };
    expect(await failed(input)).toEqual(["payouts"]);
  });

  it("rejects a transcript for another giveaway or another game setting", async () => {
    const transcript = playDice();
    transcript.session.giveawayId = `0x${"34".repeat(32)}`;
    expect(await failed(inputFor(transcript))).toContain("giveaway");

    const changed = giveawayMetadataSchema.parse({
      ...metadata,
      game: { ...metadata.game, config: { rolls: 3, windowSeconds: 60 } },
    });
    expect(await failed(inputFor(playDice(), { metadata: changed }))).toEqual(["game"]);
  });

  it("rejects malformed transcripts without throwing", async () => {
    const result = await verifySettlement({ ...inputFor(playDice()), transcript: { v: 9 } });
    expect(result).toMatchObject({ ok: false, checks: [{ name: "transcript", ok: false }] });
  });
});

describe("verifySettlement, external game", () => {
  const reporter = privateKeyToAccount(generatePrivateKey());

  async function reported(signer = reporter): Promise<ExternalTranscript> {
    const ranking = [
      { player: PLAYERS[2]!, score: 90 },
      { player: PLAYERS[0]!, score: 40 },
    ];
    const signature = await signer.signTypedData({
      domain: SCORE_REPORT_DOMAIN,
      types: SCORE_REPORT_TYPES,
      primaryType: "ScoreReport",
      message: {
        sessionId: "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
        chainId: BigInt(CHAIN_ID),
        giveawayId: GIVEAWAY,
        rankingHash: hashJson(ranking),
        gameTranscriptHash: `0x${"0".repeat(64)}`,
      },
    });
    return externalTranscriptSchema.parse({
      v: 1,
      mode: "EXTERNAL",
      session: {
        id: "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
        chainId: CHAIN_ID,
        contract: CONTRACT,
        giveawayId: GIVEAWAY,
      },
      game: { id: "racer", version: "1.0.0" },
      config: {},
      seed: SEED,
      startAt: START,
      endAt: START + 60_000,
      players: PLAYERS,
      ranking: ranking.map((entry, i) => ({ ...entry, rank: i + 1 })),
      report: {
        reporter: reporter.address,
        signature,
        gameTranscriptHash: null,
        receivedAt: START + 30_000,
      },
    });
  }

  const racer = giveawayMetadataSchema.parse({
    ...metadata,
    game: { id: "racer", version: "1.0.0", config: {} },
  });

  it("accepts standings signed by the game's reporter", async () => {
    const input = inputFor(await reported(), { metadata: racer, reporter: reporter.address });
    expect(await failed(input)).toEqual([]);
  });

  it("rejects standings signed by any other key", async () => {
    const forged = await reported(privateKeyToAccount(generatePrivateKey()));
    expect(await failed(inputFor(forged, { metadata: racer }))).toEqual(["result"]);

    const input = inputFor(await reported(), {
      metadata: racer,
      reporter: privateKeyToAccount(generatePrivateKey()).address,
    });
    expect(await failed(input)).toEqual(["result"]);
  });

  it("rejects reordered standings", async () => {
    const transcript = await reported();
    transcript.ranking.reverse();
    transcript.ranking.forEach((entry, i) => (entry.rank = i + 1));
    expect(await failed(inputFor(transcript, { metadata: racer }))).toContain("result");
  });
});
