import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { SessionStatus } from "@fairdrops/db";
import { ROUNDS_GAME_ID, findHostedGame, type AnyHostedGame } from "@fairdrops/game-kit";
import {
  MAX_ACTIONS_PER_SECOND,
  clientMessageSchema,
  sessionEventSchema,
  sessionKeys,
  type Address,
  type ClientMessage,
  type ServerMessage,
  type SessionEvent,
  type WsErrorCode,
} from "@fairdrops/shared";
import { Redis } from "ioredis";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { AuthStore } from "../auth/auth.store.js";
import type { AuthContext } from "../auth/auth.types.js";
import { API_ENV, type ApiEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";
import { REDIS } from "../infra/redis.module.js";
import { appendAction } from "./action-stream.js";

export const WS_PATH = "/ws";
const MAX_MESSAGE_BYTES = 4 * 1024;
const HEARTBEAT_MS = 30_000;
/** A client this far behind on reading is dropped; it can reconnect and get a snapshot. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
const SUBSCRIPTIONS_PER_SOCKET = 10;
const SESSION_CACHE_MS = 1_000;
/** Caps the action stream if no runtime is reading it; the log in Postgres is the record. */

/** A seat lasts this long without a heartbeat, so a crashed device frees it on its own. */
const SEAT_TTL_MS = 60_000;

/** Renews a seat only while this connection still holds it. */
const RENEW_SEAT = `if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end return 0`;
/** Frees a seat only if this connection still holds it. */
const RELEASE_SEAT = `if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1]) end return 0`;

interface Client {
  /** Identifies the connection in seat records shared by every API instance. */
  id: string;
  ws: WebSocket;
  auth: AuthContext | null;
  sessions: Set<string>;
  alive: boolean;
  tokens: number;
  refilledAt: number;
}

interface SessionInfo {
  status: SessionStatus;
  game: AnyHostedGame | null;
  loadedAt: number;
}

/**
 * Live play on `/ws`. Players connect with a single-use ticket from `POST /auth/ws-ticket`;
 * anyone may connect without one to watch.
 *
 * The gateway is stateless apart from its sockets, so any number of API instances can run it.
 * It never decides anything about a game: it checks that an action is well-formed and comes
 * from a player, appends it to the session's Redis stream (whose entry id records when it
 * arrived, on one clock for every instance), and relays what the session's runtime publishes.
 */
@Injectable()
export class SessionGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SessionGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private readonly clients = new Set<Client>();
  private readonly rooms = new Map<string, Set<Client>>();
  private readonly sessions = new Map<string, SessionInfo>();
  private readonly players = new Map<string, Set<string>>();
  private readonly subscriber: Redis;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PRISMA) private readonly db: Database,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly store: AuthStore,
  ) {
    this.subscriber = redis.duplicate();
    this.subscriber.on("message", (channel: string, message: string) => {
      this.relay(channel, message);
    });
  }

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as {
      on(
        event: "upgrade",
        listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
      ): void;
    };
    server.on("upgrade", (request, socket, head) => {
      this.upgrade(request, socket, head).catch((error: unknown) => {
        this.logger.warn(`WebSocket upgrade failed: ${(error as Error).message}`);
        socket.destroy();
      });
    });
    this.heartbeat = setInterval(() => this.checkHeartbeats(), HEARTBEAT_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.clients) client.ws.close(1001, "Server shutting down");
    this.wss.close();
    this.subscriber.disconnect();
    await Promise.resolve();
  }

  /** Open connections, for health checks and tests. */
  connectionCount(): number {
    return this.clients.size;
  }

  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (this.clients.size >= this.env.WS_MAX_CONNECTIONS) {
      reject(socket, 503, "Too many connections");
      return;
    }

    let auth: AuthContext | null = null;
    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      auth = await this.store.consumeWsTicket(ticket);
      if (!auth) {
        reject(socket, 401, "The ticket is invalid, used or expired");
        return;
      }
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.connect(ws, auth));
  }

  private connect(ws: WebSocket, auth: AuthContext | null): void {
    const client: Client = {
      id: randomUUID(),
      ws,
      auth,
      sessions: new Set(),
      alive: true,
      tokens: MAX_ACTIONS_PER_SECOND,
      refilledAt: Date.now(),
    };
    this.clients.add(client);
    ws.on("pong", () => {
      client.alive = true;
    });
    ws.on("message", (data: RawData) => {
      this.receive(client, data).catch((error: unknown) => {
        this.logger.error(`WebSocket message failed: ${(error as Error).message}`);
        this.send(client, { type: "error", code: "INTERNAL", message: "Something went wrong" });
      });
    });
    ws.on("close", () => this.disconnect(client));
    ws.on("error", () => this.disconnect(client));
    this.send(client, { type: "welcome", wallet: auth?.wallet ?? null, serverTime: Date.now() });
  }

  private async receive(client: Client, data: RawData): Promise<void> {
    let message: ClientMessage;
    try {
      const parsed = clientMessageSchema.safeParse(JSON.parse(rawToString(data)));
      if (!parsed.success) throw new Error();
      message = parsed.data;
    } catch {
      this.error(client, "BAD_MESSAGE", "Expected a JSON message the protocol defines");
      return;
    }

    switch (message.type) {
      case "ping":
        this.send(client, { type: "pong", t: message.t, serverTime: Date.now() });
        return;
      case "subscribe":
        await this.subscribe(client, message.sessionId, message.claim);
        return;
      case "unsubscribe":
        await this.unsubscribe(client, message.sessionId);
        return;
      case "action":
        await this.action(client, message);
        return;
    }
  }

  private async subscribe(client: Client, sessionId: string, claim: boolean): Promise<void> {
    const info = await this.session(sessionId, true);
    if (!info) {
      this.error(client, "NOT_FOUND", "No such session", sessionId);
      return;
    }
    if (!client.sessions.has(sessionId)) {
      if (client.sessions.size >= SUBSCRIPTIONS_PER_SOCKET) {
        this.error(
          client,
          "BAD_MESSAGE",
          `At most ${SUBSCRIPTIONS_PER_SOCKET} sessions per socket`,
          sessionId,
        );
        return;
      }
      client.sessions.add(sessionId);
      let room = this.rooms.get(sessionId);
      if (!room) {
        room = new Set();
        this.rooms.set(sessionId, room);
        await this.subscriber.subscribe(
          sessionKeys.events(sessionId),
          sessionKeys.seats(sessionId),
        );
      }
      room.add(client);
    }
    if (claim && client.auth) await this.takeSeat(client, sessionId, client.auth.wallet);

    // Subscribed before reading, so no update between the two is missed.
    const [publicView, playerView] = await Promise.all([
      this.redis.get(sessionKeys.publicView(sessionId)),
      client.auth ? this.redis.hget(sessionKeys.playerViews(sessionId), client.auth.wallet) : null,
    ]);
    this.send(client, {
      type: "snapshot",
      sessionId,
      status: info.status,
      publicView: publicView ? (JSON.parse(publicView) as unknown) : null,
      playerView: playerView ? (JSON.parse(playerView) as unknown) : null,
      serverTime: Date.now(),
    });
  }

  /**
   * Gives this connection the player's seat, replacing whichever device had it, and tells the
   * gateways so the old device's socket hears it was displaced.
   */
  private async takeSeat(client: Client, sessionId: string, wallet: Address): Promise<void> {
    await this.redis.set(sessionKeys.seat(sessionId, wallet), client.id, "PX", SEAT_TTL_MS);
    await this.redis.publish(
      sessionKeys.seats(sessionId),
      JSON.stringify({ wallet, connection: client.id }),
    );
  }

  /** Tells this player's other sockets on the session that they're now watch-only. */
  private seatTaken(sessionId: string, message: string): void {
    let taken: { wallet?: unknown; connection?: unknown };
    try {
      taken = JSON.parse(message) as typeof taken;
    } catch {
      return;
    }
    for (const client of this.rooms.get(sessionId) ?? []) {
      if (client.auth?.wallet === taken.wallet && client.id !== taken.connection) {
        this.send(client, { type: "displaced", sessionId });
      }
    }
  }

  private async unsubscribe(client: Client, sessionId: string): Promise<void> {
    client.sessions.delete(sessionId);
    if (client.auth) {
      await this.redis
        .eval(RELEASE_SEAT, 1, sessionKeys.seat(sessionId, client.auth.wallet), client.id)
        .catch(() => undefined);
    }
    const room = this.rooms.get(sessionId);
    if (!room) return;
    room.delete(client);
    if (room.size === 0) {
      this.rooms.delete(sessionId);
      await this.subscriber.unsubscribe(
        sessionKeys.events(sessionId),
        sessionKeys.seats(sessionId),
      );
    }
  }

  private async action(
    client: Client,
    message: Extract<ClientMessage, { type: "action" }>,
  ): Promise<void> {
    const { sessionId, id } = message;
    if (!client.auth) {
      this.error(client, "UNAUTHENTICATED", "Connect with a ticket to play", sessionId, id);
      return;
    }
    if (!this.takeToken(client)) {
      this.error(
        client,
        "RATE_LIMITED",
        `At most ${MAX_ACTIONS_PER_SECOND} actions per second`,
        sessionId,
        id,
      );
      return;
    }

    const info = await this.session(sessionId);
    if (!info) {
      this.error(client, "NOT_FOUND", "No such session", sessionId, id);
      return;
    }
    if (info.status !== "RUNNING" || !info.game) {
      this.error(client, "NOT_RUNNING", `The game is not running (${info.status})`, sessionId, id);
      return;
    }
    const wallet = client.auth.wallet;
    // Nobody seated (an action before any subscribe): this connection takes the seat.
    const seatKey = sessionKeys.seat(sessionId, wallet);
    await this.redis.set(seatKey, client.id, "PX", SEAT_TTL_MS, "NX");
    const seat = await this.redis.get(seatKey);
    if (seat !== client.id) {
      this.error(
        client,
        "PLAYING_ELSEWHERE",
        'You\'re playing on another device. Choose "Play here instead" to move the game here.',
        sessionId,
        id,
      );
      return;
    }
    if (!(await this.isPlayer(sessionId, wallet, info.game.id === ROUNDS_GAME_ID))) {
      this.error(
        client,
        "NOT_A_PLAYER",
        info.game.id === ROUNDS_GAME_ID
          ? "Join the game to play the next round"
          : "You did not join this game before it started",
        sessionId,
        id,
      );
      return;
    }
    const action = info.game.action.safeParse(message.action);
    if (!action.success) {
      this.error(
        client,
        "INVALID_ACTION",
        "That action does not exist in this game",
        sessionId,
        id,
      );
      return;
    }

    await appendAction(this.redis, sessionId, wallet, id, action.data);
    this.send(client, { type: "received", sessionId, id });
  }

  /** Forwards a runtime event to the sockets watching that session. */
  private relay(channel: string, message: string): void {
    const seated = /^fd:session:([^:]+):seats$/.exec(channel)?.[1];
    if (seated) {
      this.seatTaken(seated, message);
      return;
    }
    const sessionId = /^fd:session:([^:]+):events$/.exec(channel)?.[1];
    if (!sessionId) return;
    let event: SessionEvent;
    try {
      event = sessionEventSchema.parse(JSON.parse(message));
    } catch {
      this.logger.warn(`Ignoring a malformed event on ${channel}`);
      return;
    }

    if (event.kind === "status") {
      const cached = this.sessions.get(sessionId);
      if (cached) cached.status = event.status;
      if (event.status !== "RUNNING") this.players.delete(sessionId);
    }

    for (const client of this.rooms.get(sessionId) ?? []) {
      switch (event.kind) {
        case "public":
          this.send(client, { type: "public", sessionId, view: event.view });
          break;
        case "player":
          if (client.auth?.wallet === event.player) {
            this.send(client, {
              type: "player",
              sessionId,
              view: event.view,
              result: event.result,
            });
          }
          break;
        case "status":
          this.send(client, {
            type: "status",
            sessionId,
            status: event.status,
            ranking: event.ranking,
          });
          break;
      }
    }
  }

  /** Session status and game, cached briefly because every action needs them. */
  private async session(sessionId: string, fresh = false): Promise<SessionInfo | null> {
    const cached = this.sessions.get(sessionId);
    if (cached && !fresh && Date.now() - cached.loadedAt < SESSION_CACHE_MS) return cached;
    const row = await this.db.gameSession.findUnique({
      where: { id: sessionId },
      select: { status: true, mode: true, gameId: true, gameVersion: true },
    });
    if (!row) {
      this.sessions.delete(sessionId);
      return null;
    }
    const info: SessionInfo = {
      status: row.status,
      game: row.mode === "HOSTED" ? (findHostedGame(row.gameId, row.gameVersion) ?? null) : null,
      loadedAt: Date.now(),
    };
    this.sessions.set(sessionId, info);
    return info;
  }

  /**
   * The player list is loaded once per running session. Games played in rounds take joins
   * while running, so for them a wallet missing from the list is looked up before refusing.
   */
  private async isPlayer(sessionId: string, wallet: Address, rounds: boolean): Promise<boolean> {
    let players = this.players.get(sessionId);
    if (!players) {
      const rows = await this.db.sessionParticipant.findMany({
        where: { sessionId },
        select: { wallet: true },
      });
      players = new Set(rows.map((row) => row.wallet));
      this.players.set(sessionId, players);
    }
    if (players.has(wallet)) return true;
    if (!rounds) return false;
    const row = await this.db.sessionParticipant.findUnique({
      where: { sessionId_wallet: { sessionId, wallet } },
      select: { wallet: true },
    });
    if (row) players.add(wallet);
    return row !== null;
  }

  /** A token bucket per socket: MAX_ACTIONS_PER_SECOND, with that many in reserve. */
  private takeToken(client: Client): boolean {
    const now = Date.now();
    client.tokens = Math.min(
      MAX_ACTIONS_PER_SECOND,
      client.tokens + ((now - client.refilledAt) / 1000) * MAX_ACTIONS_PER_SECOND,
    );
    client.refilledAt = now;
    if (client.tokens < 1) return false;
    client.tokens -= 1;
    return true;
  }

  private checkHeartbeats(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
      // A live socket keeps its seats; one that stops answering lets them lapse.
      if (client.auth) {
        for (const sessionId of client.sessions) {
          this.redis
            .eval(
              RENEW_SEAT,
              1,
              sessionKeys.seat(sessionId, client.auth.wallet),
              client.id,
              SEAT_TTL_MS,
            )
            .catch(() => undefined);
        }
      }
    }
  }

  private disconnect(client: Client): void {
    if (!this.clients.delete(client)) return;
    for (const sessionId of client.sessions) {
      this.unsubscribe(client, sessionId).catch(() => undefined);
    }
  }

  private error(
    client: Client,
    code: WsErrorCode,
    message: string,
    sessionId?: string,
    id?: string,
  ): void {
    this.send(client, { type: "error", code, message, sessionId, id });
  }

  private send(client: Client, message: ServerMessage): void {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    if (client.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      client.ws.terminate();
      return;
    }
    client.ws.send(JSON.stringify(message));
  }
}

function reject(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}
