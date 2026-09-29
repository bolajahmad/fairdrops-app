import {
  SIGN_IN_STATEMENT,
  claimViewSchema,
  environmentContractsResponseSchema,
  gameDefinitionViewSchema,
  giveawayEventViewSchema,
  giveawayViewSchema,
  meResponseSchema,
  nonceResponseSchema,
  pageSchema,
  participantViewSchema,
  payoutTreeDumpSchema,
  sessionResponseSchema,
  sessionViewSchema,
  settlementViewSchema,
  wsTicketResponseSchema,
  type Address,
  type ClaimView,
  type DeploymentEnvironment,
  type EnvironmentContractsResponse,
  type GameDefinitionView,
  type GiveawayEventView,
  type OnchainStatus,
  type GiveawayView,
  type Hex,
  type MeResponse,
  type Page,
  type ParticipantView,
  type PayoutTreeDump,
  type SessionView,
  type SettlementView,
  type WalletConnector,
  type WsTicketResponse,
} from "@fairdrops/shared";
import { createSiweMessage } from "viem/siwe";
import { z } from "zod";
import { HttpClient, type HttpOptions } from "./http.js";
import { toSigner, type SignerLike } from "./signer.js";

export interface FairDropsOptions extends HttpOptions {
  /**
   * The origin sign-in messages name. In a browser it defaults to the page's origin. It must be
   * one FairDrops accepts: its own web app, or the `uiUrl` origin of an approved game.
   */
  origin?: string;
}

export interface SignInOptions {
  /** Which chain the wallet signs for. Any chain FairDrops supports; defaults to Base Sepolia. */
  chainId?: number;
  connector?: WalletConnector;
}

export interface GiveawayListParams {
  chainId?: number;
  status?: OnchainStatus;
  host?: Address;
  cursor?: string;
  limit?: number;
}

const PAGE_LIMIT = 100;

/**
 * The FairDrops API: sign in, browse giveaways, join and follow games, read results and claims.
 * Live play is in `@fairdrops/sdk/live`, hosting in `/host`, claiming in `/claims`, independent
 * verification in `/verify` and the game-server client in `/server`.
 */
export class FairDrops {
  readonly http: HttpClient;
  private readonly origin: string | undefined;
  private me: MeResponse | null = null;

  constructor(options: FairDropsOptions) {
    this.http = new HttpClient(options);
    this.origin =
      options.origin ?? (globalThis as { location?: { origin?: string } }).location?.origin;
  }

  get apiUrl(): string {
    return this.http.apiUrl;
  }

  // Authentication

  readonly auth = {
    /** Signs in with Sign-In with Ethereum. The signer only signs a message; no transaction. */
    signIn: async (signerLike: SignerLike, options: SignInOptions = {}): Promise<MeResponse> => {
      if (!this.origin) {
        throw new Error("Pass `origin` to new FairDrops() when not running in a browser");
      }
      const signer = toSigner(signerLike);
      const { nonce } = await this.http.post("/auth/nonce", {
        body: { address: signer.address },
        schema: nonceResponseSchema,
      });
      const origin = new URL(this.origin);
      const message = createSiweMessage({
        address: signer.address,
        chainId: options.chainId ?? 84532,
        domain: origin.host,
        uri: origin.origin,
        nonce,
        version: "1",
        statement: SIGN_IN_STATEMENT,
        issuedAt: new Date(),
      });
      const signature = await signer.signMessage(message);
      const session = await this.http.post("/auth/verify", {
        body: {
          message,
          signature,
          connector: options.connector ?? "other",
          transport: this.http.transport,
        },
        schema: sessionResponseSchema,
      });
      this.http.accept(session);
      this.me = session.me;
      return session.me;
    },

    signOut: async (): Promise<void> => {
      if (await this.http.accessToken()) {
        await this.http
          .post("/auth/logout", { schema: z.undefined(), auth: "required" })
          .catch(() => undefined);
      }
      this.http.tokens.set(null);
      this.me = null;
    },

    isSignedIn: (): boolean => this.http.tokens.get() !== null,

    /** The signed-in user, from the API. */
    me: async (): Promise<MeResponse> => {
      this.me = await this.http.get("/auth/me", { schema: meResponseSchema, auth: "required" });
      return this.me;
    },

    /** The wallet the current session signed in with, if known without a request. */
    wallet: (): Address | null => this.me?.wallet ?? null,

    /** A single-use ticket for the WebSocket. */
    wsTicket: (): Promise<WsTicketResponse> =>
      this.http.post("/auth/ws-ticket", { schema: wsTicketResponseSchema, auth: "required" }),
  };

  // Giveaways

  readonly giveaways = {
    list: (params: GiveawayListParams = {}): Promise<Page<GiveawayView>> =>
      this.http.get("/giveaways", {
        query: {
          chainId: params.chainId,
          status: params.status,
          host: params.host,
          cursor: params.cursor,
          limit: params.limit ?? 20,
        },
        schema: pageSchema(giveawayViewSchema),
      }),

    get: (chainId: number, giveawayId: Hex): Promise<GiveawayView> =>
      this.http.get(`/giveaways/${chainId}/${giveawayId}`, { schema: giveawayViewSchema }),

    /** Every on-chain event about the giveaway, oldest first. */
    events: async (chainId: number, giveawayId: Hex): Promise<GiveawayEventView[]> =>
      this.all((cursor) =>
        this.http.get(`/giveaways/${chainId}/${giveawayId}/events`, {
          query: { cursor, limit: PAGE_LIMIT },
          schema: pageSchema(giveawayEventViewSchema),
        }),
      ),
  };

  // Sessions

  readonly sessions = {
    get: (sessionId: string): Promise<SessionView> =>
      this.http.get(`/sessions/${sessionId}`, { schema: sessionViewSchema }),

    byGiveaway: (chainId: number, giveawayId: Hex): Promise<SessionView> =>
      this.http.get(`/sessions/by-giveaway/${chainId}/${giveawayId}`, {
        schema: sessionViewSchema,
      }),

    participants: (sessionId: string): Promise<ParticipantView[]> =>
      this.all((cursor) =>
        this.http.get(`/sessions/${sessionId}/participants`, {
          query: { cursor, limit: PAGE_LIMIT },
          schema: pageSchema(participantViewSchema),
        }),
      ),

    /** Joins as the signed-in wallet. Only before the game starts. */
    join: (sessionId: string): Promise<ParticipantView> =>
      this.http.post(`/sessions/${sessionId}/join`, {
        schema: participantViewSchema,
        auth: "required",
      }),

    /** The published record of a finished game. Verify it with `@fairdrops/sdk/verify`. */
    transcript: (sessionId: string): Promise<unknown> =>
      this.http.get(`/sessions/${sessionId}/transcript`, { schema: z.unknown() }),
  };

  // Results

  readonly settlement = {
    get: (sessionId: string): Promise<SettlementView> =>
      this.http.get(`/sessions/${sessionId}/settlement`, { schema: settlementViewSchema }),

    payoutTree: (sessionId: string): Promise<PayoutTreeDump> =>
      this.http.get(`/sessions/${sessionId}/payout-tree`, { schema: payoutTreeDumpSchema }),
  };

  readonly claims = {
    /** What an account won in a giveaway, with the Merkle proof to claim it. */
    get: (chainId: number, giveawayId: Hex, account: Address): Promise<ClaimView> =>
      this.http.get(`/claims/${chainId}/${giveawayId}/${account.toLowerCase()}`, {
        schema: claimViewSchema,
      }),

    /** Prizes won by any wallet linked to the signed-in user. */
    mine: (): Promise<ClaimView[]> =>
      this.http.get("/me/claims", { schema: z.array(claimViewSchema), auth: "required" }),
  };

  // Reference data

  readonly games = {
    get: (id: string, version: string): Promise<GameDefinitionView> =>
      this.http.get(`/games/${id}/${version}`, { schema: gameDefinitionViewSchema }),
  };

  readonly contracts = {
    list: (environment?: DeploymentEnvironment): Promise<EnvironmentContractsResponse> =>
      this.http.get(environment ? `/contracts/${environment}` : "/contracts", {
        schema: environmentContractsResponseSchema,
      }),
  };

  private async all<T>(fetchPage: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined;
    do {
      const page = await fetchPage(cursor);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  }
}
