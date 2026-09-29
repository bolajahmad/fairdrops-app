import {
  MAX_ACTIONS_PER_SECOND,
  serverMessageSchema,
  type ActionResult,
  type Address,
  type ClientMessage,
  type ServerMessage,
  type SessionStatus,
  type StandingView,
  type WsErrorCode,
} from "@fairdrops/shared";
import type { FairDrops } from "./client.js";
import { FairDropsError } from "./errors.js";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

/** The subset of the WHATWG WebSocket the client uses; Node 22+ and browsers provide it. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface LiveOptions {
  /** Defaults to the global WebSocket. */
  webSocket?: WebSocketFactory;
  /** Connect without signing in, to watch. Defaults to signing in when the client has a session. */
  spectate?: boolean;
  /** Ping interval, which also keeps the clock estimate fresh. */
  pingIntervalMs?: number;
  /** Largest pause between reconnection attempts. */
  maxBackoffMs?: number;
}

const OPEN = 1;
const INITIAL_BACKOFF_MS = 500;
/** Weight of the newest sample in the clock and round-trip estimates. */
const SMOOTHING = 0.25;

interface PendingAction {
  sessionId: string;
  id: string;
  action: unknown;
  resolve(result: ActionResult): void;
  reject(error: Error): void;
}

type Listener<T> = (value: T) => void;

class Emitter<Events> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => set.delete(listener);
  }

  protected emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? [])
      (listener as Listener<Events[K]>)(value);
  }
}

export interface RoomEvents<PublicView, PlayerView> {
  snapshot: { status: SessionStatus; publicView: PublicView | null; playerView: PlayerView | null };
  public: PublicView;
  player: { view: PlayerView; result?: ActionResult };
  status: { status: SessionStatus; ranking?: StandingView[] };
  error: { code: WsErrorCode; message: string };
}

/**
 * One session over the connection. Views are typed by the game: pass the game's public and
 * player view types, e.g. `live.subscribe<DicePublicView, DicePlayerView>(sessionId)`.
 */
export class Room<PublicView = unknown, PlayerView = unknown> extends Emitter<
  RoomEvents<PublicView, PlayerView>
> {
  status: SessionStatus | null = null;
  publicView: PublicView | null = null;
  playerView: PlayerView | null = null;
  ranking: StandingView[] | null = null;

  constructor(
    readonly sessionId: string,
    private readonly connection: LiveConnection,
  ) {
    super();
  }

  /**
   * Sends an action and resolves with the game's verdict once the server has sequenced it. The
   * id stays the same across reconnections, so a resent action is only ever applied once.
   */
  act(action: unknown): Promise<ActionResult> {
    return this.connection.act(this.sessionId, action);
  }

  unsubscribe(): void {
    this.connection.unsubscribe(this.sessionId);
  }

  /** @internal */
  handle(message: ServerMessage): void {
    switch (message.type) {
      case "snapshot":
        this.status = message.status;
        this.publicView = message.publicView as PublicView | null;
        this.playerView = message.playerView as PlayerView | null;
        this.emit("snapshot", {
          status: message.status,
          publicView: this.publicView,
          playerView: this.playerView,
        });
        return;
      case "public":
        this.publicView = message.view as PublicView;
        this.emit("public", this.publicView);
        return;
      case "player":
        this.playerView = message.view as PlayerView;
        this.emit("player", { view: this.playerView, result: message.result });
        return;
      case "status":
        this.status = message.status;
        if (message.ranking) this.ranking = message.ranking;
        this.emit("status", { status: message.status, ranking: message.ranking });
        return;
      case "error":
        this.emit("error", { code: message.code, message: message.message });
        return;
      case "welcome":
      case "received":
      case "pong":
        return;
    }
  }
}

interface ConnectionEvents {
  state: ConnectionState;
  welcome: { wallet: Address | null };
}

/**
 * A live connection to the FairDrops gateway, shared by any number of sessions. It reconnects
 * with backoff, subscribes again, resyncs every room from a fresh snapshot, resends actions that
 * had no result yet, and estimates the server clock so countdowns match the server.
 */
export class LiveConnection extends Emitter<ConnectionEvents> {
  state: ConnectionState = "connecting";
  /** The signed-in wallet, or null for a spectator. */
  wallet: Address | null = null;
  /** Estimated `server time - local time`, in milliseconds. */
  clockOffsetMs = 0;
  roundTripMs: number | null = null;

  private socket: WebSocketLike | null = null;
  private readonly rooms = new Map<string, Room<unknown, unknown>>();
  private readonly pending = new Map<string, PendingAction>();
  private readonly sent: number[] = [];
  private attempt = 0;
  private counter = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  private constructor(
    private readonly fd: FairDrops,
    private readonly options: LiveOptions,
  ) {
    super();
  }

  /** Opens a connection and resolves once the gateway has welcomed it. */
  static async connect(fd: FairDrops, options: LiveOptions = {}): Promise<LiveConnection> {
    const connection = new LiveConnection(fd, options);
    await connection.open();
    return connection;
  }

  /** The server's clock, as best known. Use it for anything timed by the game. */
  now(): number {
    return Date.now() + this.clockOffsetMs;
  }

  subscribe<PublicView = unknown, PlayerView = unknown>(
    sessionId: string,
  ): Room<PublicView, PlayerView> {
    const existing = this.rooms.get(sessionId);
    if (existing) return existing as Room<PublicView, PlayerView>;
    const room = new Room<PublicView, PlayerView>(sessionId, this);
    this.rooms.set(sessionId, room);
    this.send({ type: "subscribe", sessionId });
    return room;
  }

  /** @internal */
  unsubscribe(sessionId: string): void {
    this.rooms.delete(sessionId);
    this.send({ type: "unsubscribe", sessionId });
    for (const [id, pending] of this.pending) {
      if (pending.sessionId !== sessionId) continue;
      pending.reject(new FairDropsError("BAD_REQUEST", "Unsubscribed before the result arrived"));
      this.pending.delete(id);
    }
  }

  /** @internal */
  act(sessionId: string, action: unknown): Promise<ActionResult> {
    if (!this.wallet) {
      return Promise.reject(
        new FairDropsError("UNAUTHENTICATED", "Sign in to play; spectators cannot act"),
      );
    }
    // The gateway allows MAX_ACTIONS_PER_SECOND per socket; refuse locally rather than be cut off.
    const now = Date.now();
    while (this.sent.length > 0 && now - this.sent[0]! >= 1000) this.sent.shift();
    if (this.sent.length >= MAX_ACTIONS_PER_SECOND) {
      return Promise.reject(new FairDropsError("RATE_LIMITED", "Too many actions; slow down"));
    }
    this.sent.push(now);

    const id = `${now.toString(36)}-${(this.counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<ActionResult>((resolve, reject) => {
      this.pending.set(id, { sessionId, id, action, resolve, reject });
      this.send({ type: "action", sessionId, id, action });
    });
  }

  close(): void {
    this.closedByUser = true;
    this.stopTimers();
    this.setState("closed");
    this.socket?.close(1000, "closed by client");
    for (const pending of this.pending.values()) {
      pending.reject(new FairDropsError("NETWORK", "Connection closed"));
    }
    this.pending.clear();
  }

  private async open(): Promise<void> {
    const url = new URL(`${this.fd.apiUrl}/ws`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (!this.options.spectate && this.fd.auth.isSignedIn()) {
      const { ticket } = await this.fd.auth.wsTicket();
      url.searchParams.set("ticket", ticket);
    }

    const factory =
      this.options.webSocket ??
      ((target: string) => {
        const Native = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
        if (!Native) throw new Error("No WebSocket available; pass options.webSocket");
        return new Native(target);
      });

    await new Promise<void>((resolve, reject) => {
      const socket = factory(url.toString());
      this.socket = socket;
      let welcomed = false;

      socket.addEventListener("message", (event) => {
        const message = this.parse(event.data);
        if (!message) return;
        if (message.type === "welcome" && !welcomed) {
          welcomed = true;
          this.wallet = message.wallet;
          this.attempt = 0;
          this.observeClock(message.serverTime, null);
          this.setState("open");
          this.emit("welcome", { wallet: message.wallet });
          this.resume();
          resolve();
        }
        this.dispatch(message);
      });
      socket.addEventListener("close", () => {
        this.stopTimers();
        // Before the welcome, the failure belongs to whoever called open(): connect() rejects,
        // and a reconnection attempt schedules the next one itself. Only an established
        // connection that drops reconnects from here, so attempts never run in parallel.
        if (!welcomed) {
          reject(new FairDropsError("NETWORK", "The gateway closed the connection"));
          return;
        }
        if (!this.closedByUser) this.scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        // A close event always follows; reconnection is handled there.
      });
    });

    const interval = this.options.pingIntervalMs ?? 10_000;
    this.pingTimer = setInterval(() => this.send({ type: "ping", t: Date.now() }), interval);
  }

  /** After (re)connecting: subscribe every room again and resend actions with no result yet. */
  private resume(): void {
    for (const sessionId of this.rooms.keys()) this.send({ type: "subscribe", sessionId });
    for (const pending of this.pending.values()) {
      this.send({
        type: "action",
        sessionId: pending.sessionId,
        id: pending.id,
        action: pending.action,
      });
    }
  }

  private dispatch(message: ServerMessage): void {
    switch (message.type) {
      case "pong":
        if (message.t !== undefined) this.observeClock(message.serverTime, Date.now() - message.t);
        return;
      case "player":
        if (message.result) {
          const pending = this.pending.get(message.result.id);
          if (pending) {
            this.pending.delete(message.result.id);
            pending.resolve(message.result);
          }
        }
        break;
      case "error":
        if (message.id) {
          const pending = this.pending.get(message.id);
          if (pending) {
            this.pending.delete(message.id);
            pending.reject(new FairDropsError(message.code, message.message));
          }
        }
        break;
      case "welcome":
      case "snapshot":
      case "public":
      case "status":
      case "received":
        break;
    }
    const sessionId = "sessionId" in message ? message.sessionId : undefined;
    if (sessionId) this.rooms.get(sessionId)?.handle(message);
  }

  private observeClock(serverTime: number, roundTripMs: number | null): void {
    const localMidpoint = Date.now() - (roundTripMs ?? 0) / 2;
    const offset = serverTime - localMidpoint;
    if (roundTripMs === null && this.roundTripMs !== null) return;
    this.clockOffsetMs =
      this.roundTripMs === null
        ? offset
        : this.clockOffsetMs + SMOOTHING * (offset - this.clockOffsetMs);
    if (roundTripMs !== null) {
      this.roundTripMs =
        this.roundTripMs === null
          ? roundTripMs
          : this.roundTripMs + SMOOTHING * (roundTripMs - this.roundTripMs);
    }
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    const max = this.options.maxBackoffMs ?? 15_000;
    const base = Math.min(max, INITIAL_BACKOFF_MS * 2 ** this.attempt++);
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectTimer = setTimeout(() => {
      this.open().catch(() => {
        if (!this.closedByUser) this.scheduleReconnect();
      });
    }, delay);
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
    // Otherwise it is sent by resume() once the connection is back.
  }

  private parse(data: unknown): ServerMessage | null {
    if (typeof data !== "string") return null;
    try {
      const parsed = serverMessageSchema.safeParse(JSON.parse(data));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit("state", state);
  }

  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }
}
