import { MAX_ACTIONS_PER_SECOND, type ClientMessage, type ServerMessage } from "@fairdrops/shared";
import { afterEach, describe, expect, it } from "vitest";
import { FairDrops } from "../src/client.js";
import { LiveConnection, type WebSocketLike } from "../src/live.js";

const SESSION = "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b";
const WALLET = "0x00000000000000000000000000000000000000a1";

/** A gateway in memory: records what the client sends, and lets tests push server messages. */
class FakeSocket implements WebSocketLike {
  /** How many of the next connections the gateway refuses (closes before the welcome). */
  static refuse = 0;
  readyState = 0;
  sent: ClientMessage[] = [];
  private listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};

  constructor(readonly url: string) {
    const refused = FakeSocket.refuse > 0;
    if (refused) FakeSocket.refuse -= 1;
    queueMicrotask(() => {
      if (refused) {
        this.close();
        return;
      }
      this.readyState = 1;
      this.fire("open");
      this.push({ type: "welcome", wallet: WALLET, serverTime: Date.now() + 5_000 });
    });
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire("close");
  }

  push(message: ServerMessage): void {
    this.fire("message", { data: JSON.stringify(message) });
  }

  private fire(type: string, event: { data: unknown } = { data: undefined }): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const fd = new FairDrops({ apiUrl: "https://api.test", origin: "https://game.test" });
  // Signed in without a network: the ticket request is the only API call the live client makes.
  fd.http.tokens.set({
    accessToken: "t",
    accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
  fd.auth.wsTicket = () =>
    Promise.resolve({ ticket: `ticket-${sockets.length}`, expiresAt: new Date().toISOString() });
  const webSocket = (url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  };
  return { fd, sockets, webSocket };
}

let live: LiveConnection | null = null;
afterEach(() => live?.close());

describe("LiveConnection", () => {
  it("connects with a ticket and learns the wallet and the server clock", async () => {
    const { fd, sockets, webSocket } = setup();
    live = await LiveConnection.connect(fd, { webSocket, pingIntervalMs: 60_000 });
    expect(sockets[0]!.url).toBe("wss://api.test/ws?ticket=ticket-0");
    expect(live.wallet).toBe(WALLET);
    expect(live.state).toBe("open");
    expect(live.clockOffsetMs).toBeGreaterThan(4_000);
  });

  it("resolves an action with the result that carries its id", async () => {
    const { fd, sockets, webSocket } = setup();
    live = await LiveConnection.connect(fd, { webSocket, pingIntervalMs: 60_000 });
    const room = live.subscribe(SESSION);
    const result = room.act({ type: "roll" });

    const sent = sockets[0]!.sent.find((m) => m.type === "action")!;
    expect(sent).toMatchObject({ type: "action", sessionId: SESSION, action: { type: "roll" } });
    const id = (sent as { id: string }).id;
    sockets[0]!.push({
      type: "player",
      sessionId: SESSION,
      view: { rolls: 1 },
      result: { id, seq: 0, accepted: true },
    });
    await expect(result).resolves.toEqual({ id, seq: 0, accepted: true });
    expect(room.playerView).toEqual({ rolls: 1 });
  });

  it("rejects an action the gateway refuses", async () => {
    const { fd, sockets, webSocket } = setup();
    live = await LiveConnection.connect(fd, { webSocket, pingIntervalMs: 60_000 });
    const result = live.subscribe(SESSION).act({ type: "roll" });
    const { id } = sockets[0]!.sent.find((m) => m.type === "action") as { id: string };
    sockets[0]!.push({
      type: "error",
      code: "NOT_RUNNING",
      message: "Not yet",
      sessionId: SESSION,
      id,
    });
    await expect(result).rejects.toMatchObject({ code: "NOT_RUNNING" });
  });

  it("reconnects, subscribes again and resends unanswered actions with the same id", async () => {
    const { fd, sockets, webSocket } = setup();
    live = await LiveConnection.connect(fd, {
      webSocket,
      pingIntervalMs: 60_000,
      maxBackoffMs: 10,
    });
    const room = live.subscribe(SESSION);
    const result = room.act({ type: "roll" });
    const { id } = sockets[0]!.sent.find((m) => m.type === "action") as { id: string };

    const states: string[] = [];
    live.on("state", (state) => states.push(state));
    sockets[0]!.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(states).toEqual(["reconnecting", "open"]);
    expect(sockets[1]!.url).toContain("ticket=ticket-1");
    expect(sockets[1]!.sent).toEqual([
      { type: "subscribe", sessionId: SESSION },
      { type: "action", sessionId: SESSION, id, action: { type: "roll" } },
    ]);
    sockets[1]!.push({
      type: "player",
      sessionId: SESSION,
      view: {},
      result: { id, seq: 0, accepted: true },
    });
    await expect(result).resolves.toMatchObject({ id });
  });

  it("makes one reconnection attempt at a time, however many fail", async () => {
    const { fd, sockets, webSocket } = setup();
    live = await LiveConnection.connect(fd, {
      webSocket,
      pingIntervalMs: 60_000,
      maxBackoffMs: 10,
    });
    FakeSocket.refuse = 2;
    sockets[0]!.close();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The drop, two refused attempts, then one that succeeds: four sockets, never more.
    expect(sockets).toHaveLength(4);
    expect(live.state).toBe("open");
    expect(sockets.filter((s) => s.readyState === 1)).toHaveLength(1);
  });

  it("refuses actions beyond the gateway's rate limit without sending them", async () => {
    const { fd, sockets, webSocket } = setup();
    live = await LiveConnection.connect(fd, { webSocket, pingIntervalMs: 60_000 });
    const room = live.subscribe(SESSION);
    const attempts = Array.from({ length: MAX_ACTIONS_PER_SECOND + 1 }, () =>
      room.act({ type: "roll" }).catch((error: unknown) => error),
    );
    await expect(attempts.at(-1)).resolves.toMatchObject({ code: "RATE_LIMITED" });
    expect(sockets[0]!.sent.filter((m) => m.type === "action")).toHaveLength(
      MAX_ACTIONS_PER_SECOND,
    );
  });

  it("keeps each room's views and status current", async () => {
    const { fd, sockets, webSocket } = setup();
    live = await LiveConnection.connect(fd, { webSocket, pingIntervalMs: 60_000 });
    const room = live.subscribe<{ phase: string }, { mine: number }>(SESSION);
    const statuses: string[] = [];
    room.on("status", ({ status }) => statuses.push(status));

    const socket = sockets[0]!;
    socket.push({
      type: "snapshot",
      sessionId: SESSION,
      status: "RUNNING",
      publicView: { phase: "rolling" },
      playerView: { mine: 0 },
      serverTime: Date.now(),
    });
    socket.push({ type: "public", sessionId: SESSION, view: { phase: "ended" } });
    socket.push({
      type: "status",
      sessionId: SESSION,
      status: "SETTLING",
      ranking: [{ player: WALLET, score: 9, rank: 1 }],
    });

    expect(room.publicView).toEqual({ phase: "ended" });
    expect(room.playerView).toEqual({ mine: 0 });
    expect(room.status).toBe("SETTLING");
    expect(room.ranking).toEqual([{ player: WALLET, score: 9, rank: 1 }]);
    expect(statuses).toEqual(["SETTLING"]);
  });

  it("watches without signing in when asked to spectate", async () => {
    const { fd, sockets, webSocket } = setup();
    live = await LiveConnection.connect(fd, { webSocket, spectate: true, pingIntervalMs: 60_000 });
    expect(sockets[0]!.url).toBe("wss://api.test/ws");
  });
});
