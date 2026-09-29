/**
 * For an external game's server: read who is playing, and report the final standings signed with
 * the game's reporter key. Keep the API key and the reporter key on the server; never ship them
 * to players.
 */
import { hashJson } from "@fairdrops/game-kit";
import {
  SCORE_REPORT_DOMAIN,
  SCORE_REPORT_TYPES,
  sessionViewSchema,
  type Address,
  type Hex,
  type ParticipantView,
  type SessionView,
} from "@fairdrops/shared";
import { FairDrops } from "./client.js";
import { toSigner, type Signer, type SignerLike } from "./signer.js";

const ZERO: Hex = `0x${"0".repeat(64)}`;

export interface ScoreReporterOptions {
  apiUrl: string;
  /** An API key with the `scores:write` scope, owned by the game's developer. */
  apiKey: string;
  /** The key registered as the game's `reporterAddress`. */
  reporter: SignerLike;
  fetch?: typeof fetch;
}

export interface ReportEntry {
  player: Address;
  /** An integer; only the order matters to FairDrops, best first. */
  score: number;
}

export class ScoreReporter {
  readonly fd: FairDrops;
  private readonly signer: Signer;

  constructor(options: ScoreReporterOptions) {
    this.fd = new FairDrops({
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      fetch: options.fetch,
    });
    this.signer = toSigner(options.reporter);
  }

  session(sessionId: string): Promise<SessionView> {
    return this.fd.sessions.get(sessionId);
  }

  /** Everyone who joined before the start. Only they can be ranked. */
  players(sessionId: string): Promise<ParticipantView[]> {
    return this.fd.sessions.participants(sessionId);
  }

  /**
   * Reports the final standings, best first. FairDrops checks the signature against the game's
   * registered reporter, that every ranked player joined, and that the game is still running, and
   * accepts one report per session.
   */
  async report(
    sessionId: string,
    ranking: readonly ReportEntry[],
    gameTranscriptHash: Hex | null = null,
  ): Promise<SessionView> {
    const session = await this.session(sessionId);
    const normalized = ranking.map((entry) => ({
      player: entry.player.toLowerCase() as Address,
      score: entry.score,
    }));
    const signature = await this.signer.signTypedData({
      domain: SCORE_REPORT_DOMAIN,
      types: SCORE_REPORT_TYPES,
      primaryType: "ScoreReport",
      message: {
        sessionId,
        chainId: BigInt(session.chainId),
        giveawayId: session.giveawayId,
        rankingHash: hashJson(normalized),
        gameTranscriptHash: gameTranscriptHash ?? ZERO,
      },
    });
    return this.fd.http.post(`/sessions/${sessionId}/score-report`, {
      body: { ranking: normalized, gameTranscriptHash, signature },
      schema: sessionViewSchema,
      apiKey: true,
    });
  }
}
