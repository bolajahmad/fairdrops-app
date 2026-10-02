import {
  findHostedGame,
  hashJson,
  rosterActionSchema,
  sessionGameOf,
  transcriptHash,
  transcriptSchema,
  verifyTranscript,
  type Transcript,
} from "@fairdrops/game-kit";
import {
  SCORE_REPORT_DOMAIN,
  SCORE_REPORT_TYPES,
  canonicalJson,
  rewardPolicyOf,
  rewardPolicyProblem,
  type Address,
  type GiveawayMetadata,
  type Hex,
} from "@fairdrops/shared";
import { recoverTypedDataAddress } from "viem";
import { computeSettlement, type ComputedSettlement } from "./settlement.js";
import { seedCommitment, type SettlementMessage } from "./typed-data.js";

const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;

export interface VerifySettlementInput {
  chainId: number;
  contract: Address;
  giveawayId: Hex;
  /** From the chain: `getGiveaway(id)`. */
  giveaway: { prize: bigint; maxWinners: number; seedCommitment: Hex };
  /** The host's metadata document, whose hash is on-chain. */
  metadata: GiveawayMetadata;
  /** The published transcript. Anything that parses as JSON; it is validated here. */
  transcript: unknown;
  /** The settlement to check: signed by verifiers, or recorded on-chain by `finalize`. */
  settlement: SettlementMessage;
  /** For an external game, the reporter key registered for it, if known. */
  reporter?: Address;
}

export type CheckName =
  "transcript" | "giveaway" | "game" | "seed" | "result" | "transcriptHash" | "payouts";

export interface VerificationCheck {
  name: CheckName;
  ok: boolean;
  detail: string;
}

export interface SettlementVerification {
  ok: boolean;
  checks: VerificationCheck[];
  /** The settlement recomputed from the transcript, when the transcript could be read. */
  computed: ComputedSettlement | null;
}

/**
 * Checks a settlement from public data alone, the way a FairDrops verifier does before signing
 * and the way anyone can afterwards:
 *
 * 1. the transcript is for this giveaway, with the game and settings the host committed to;
 * 2. its seed is the one committed on-chain before the start;
 * 3. its result stands: replaying a hosted game gives the same standings, and an external game's
 *    standings carry a valid signature from its reporter;
 * 4. its hash is the settled `transcriptHash`;
 * 5. applying the host's reward policy to the standings gives the settled payout root, total and
 *    winner count.
 */
export async function verifySettlement(
  input: VerifySettlementInput,
): Promise<SettlementVerification> {
  const checks: VerificationCheck[] = [];
  const check = (name: CheckName, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    return ok;
  };
  const done = (computed: ComputedSettlement | null): SettlementVerification => ({
    ok: checks.every((c) => c.ok),
    checks,
    computed,
  });

  const parsed = transcriptSchema.safeParse(input.transcript);
  if (!parsed.success) {
    check("transcript", false, "The transcript is malformed");
    return done(null);
  }
  check("transcript", true, "Well-formed");
  const transcript: Transcript = parsed.data;
  const expected = input.settlement;

  const { session } = transcript;
  check(
    "giveaway",
    session.chainId === input.chainId &&
      session.contract === input.contract.toLowerCase() &&
      session.giveawayId === input.giveawayId.toLowerCase(),
    `Transcript is for giveaway ${session.giveawayId} on chain ${session.chainId}`,
  );

  check("game", ...gameMatches(transcript, input.metadata, input.giveaway.maxWinners));

  const commitment = seedCommitment(input.giveawayId, transcript.seed);
  check(
    "seed",
    commitment === input.giveaway.seedCommitment.toLowerCase() &&
      transcript.seed === expected.seed.toLowerCase(),
    commitment === input.giveaway.seedCommitment.toLowerCase()
      ? transcript.seed === expected.seed.toLowerCase()
        ? "The revealed seed matches the commitment made before the start"
        : "The settlement reveals a different seed from the transcript"
      : "The transcript's seed does not match the on-chain commitment",
  );

  check("result", ...(await resultStands(transcript, input.reporter)));

  const hash = transcriptHash(transcript);
  check(
    "transcriptHash",
    hash === expected.transcriptHash.toLowerCase(),
    `Transcript hashes to ${hash}`,
  );

  const policy = rewardPolicyOf(input.metadata, input.giveaway.maxWinners);
  const problem = rewardPolicyProblem(policy, input.giveaway.maxWinners);
  if (problem) {
    check("payouts", false, problem);
    return done(null);
  }
  const computed = computeSettlement({
    giveawayId: input.giveawayId,
    ranking: transcript.ranking,
    awards: transcript.mode === "HOSTED" ? transcript.awards : undefined,
    policy,
    prize: input.giveaway.prize,
  });
  if (!computed) {
    check("payouts", false, "Nobody qualifies for a prize, so nothing should be settled");
    return done(null);
  }
  const matches =
    computed.payoutRoot === expected.payoutRoot.toLowerCase() &&
    computed.totalPayout === expected.totalPayout &&
    computed.winnerCount === expected.winnerCount;
  check(
    "payouts",
    matches,
    matches
      ? `${computed.winnerCount} payouts totalling ${computed.totalPayout} under the ${policy.kind} policy`
      : `The policy gives root ${computed.payoutRoot}, total ${computed.totalPayout} and ` +
          `${computed.winnerCount} winners, not what was settled`,
  );
  return done(computed);
}

function gameMatches(
  transcript: Transcript,
  metadata: GiveawayMetadata,
  maxWinners: number,
): [boolean, string] {
  const committed = sessionGameOf(metadata, maxWinners);
  if (transcript.game.id !== committed.id || transcript.game.version !== committed.version) {
    return [
      false,
      `Transcript plays ${transcript.game.id}@${transcript.game.version}, ` +
        `the host chose ${committed.id}@${committed.version}`,
    ];
  }
  // Hosted games apply defaults to the host's settings; the transcript records the result.
  let config: unknown = committed.config;
  if (transcript.mode === "HOSTED") {
    const game = findHostedGame(committed.id, committed.version);
    if (!game) return [false, `Unknown hosted game ${committed.id}@${committed.version}`];
    const parsed = game.config.safeParse(committed.config);
    if (!parsed.success) return [false, "The host's settings are not valid for this game"];
    config = parsed.data;
  }
  if (canonicalJson(config) !== canonicalJson(transcript.config)) {
    return [false, "The transcript's settings differ from the ones the host committed to"];
  }
  return [true, `${committed.id}@${committed.version} with the host's settings`];
}

async function resultStands(
  transcript: Transcript,
  reporter: Address | undefined,
): Promise<[boolean, string]> {
  // Games played in rounds take joins between rounds, which the action log records.
  const players = new Set(transcript.players);
  if (transcript.mode === "HOSTED") {
    for (const entry of transcript.actions) {
      if (rosterActionSchema.safeParse(entry.action).success) players.add(entry.player);
    }
  }
  if (transcript.ranking.some((entry) => !players.has(entry.player))) {
    return [false, "The standings include someone who never joined"];
  }

  if (transcript.mode === "HOSTED") {
    const replayed = verifyTranscript(transcript);
    return replayed.ok
      ? [true, `Replaying ${transcript.actions.length} actions gives the same standings`]
      : [false, replayed.reason];
  }

  const { report } = transcript;
  let signer: Address;
  try {
    signer = (
      await recoverTypedDataAddress({
        domain: SCORE_REPORT_DOMAIN,
        types: SCORE_REPORT_TYPES,
        primaryType: "ScoreReport",
        message: {
          sessionId: transcript.session.id,
          chainId: BigInt(transcript.session.chainId),
          giveawayId: transcript.session.giveawayId,
          rankingHash: hashJson(
            transcript.ranking.map((entry) => ({ player: entry.player, score: entry.score })),
          ),
          gameTranscriptHash: report.gameTranscriptHash ?? ZERO_HASH,
        },
        signature: report.signature,
      })
    ).toLowerCase() as Address;
  } catch {
    return [false, "The score report signature is invalid"];
  }
  if (signer !== report.reporter) {
    return [false, `The score report was signed by ${signer}, not ${report.reporter}`];
  }
  if (reporter && signer !== reporter.toLowerCase()) {
    return [false, `The score report was signed by ${signer}, not the game's reporter ${reporter}`];
  }
  const ranks = transcript.ranking.every((entry, i) => entry.rank === i + 1);
  if (!ranks) return [false, "Ranks do not follow the reported order"];
  return [true, `Standings signed by the game's reporter ${signer}`];
}
