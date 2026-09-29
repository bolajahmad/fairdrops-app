import type { AddressInfo } from "node:net";
import {
  MAX_ACTIONS_PER_SECOND,
  serverMessageSchema,
  sessionKeys,
  wsTicketResponseSchema,
  type Address,
  type ClientMessage,
  type ServerMessage,
  type SessionEvent,
} from "@fairdrops/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createTestApp, signIn, type SignedIn, type TestApp } from "./harness.js";
import { addPlayer, createSession } from "./session-fixtures.js";

let t: TestApp;
let base: string;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  t = await createTestApp();
  await new Promise<void>((resolve) => t.server.listen(0, "127.0.0.1", resolve));
  base = `ws://127.0.0.1:${(t.server.address() as AddressInfo).port}/ws`;
});

afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  await t.close();
});

beforeEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await t.reset();
});

interface TestSocket {
  messages: ServerMessage[];
  send(message: ClientMessage | object): void;
  /** Resolves with the first message (already received or future) that matches. */
  next<T extends ServerMessage["type"]>(
    type: T,
    where?: (message: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>>;
}

async function connect(ticket?: string): Promise<TestSocket> {
  const ws = new WebSocket(ticket ? `${base}?ticket=${ticket}` : base);
  sockets.push(ws);
  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (data: Buffer) => {
    messages.push(serverMessageSchema.parse(JSON.parse(data.toString("utf8"))));
    for (const wake of waiters.splice(0)) wake();
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const socket: TestSocket = {
    messages,
    send: (message) => ws.send(JSON.stringify(message)),
    async next(type, where = () => true) {
      const deadline = Date.now() + 3_000;
      for (;;) {
        const found = messages.find(
          (m): m is Extract<ServerMessage, { type: typeof type }> =>
            m.type === type && where(m as never),
        );
        if (found) {
          messages.splice(messages.indexOf(found), 1);
          return found;
        }
        if (Date.now() > deadline)
          throw new Error(`No ${type} message; got ${JSON.stringify(messages)}`);
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 100);
        });
      }
    },
  };
  await socket.next("welcome");
  return socket;
}

async function ticketFor(user: SignedIn): Promise<string> {
  const response = await request(t.server)
    .post("/auth/ws-ticket")
    .set("authorization", user.bearer)
    .expect(200);
  return wsTicketResponseSchema.parse(response.body).ticket;
}

async function playerSocket(sessionId?: string) {
  const user = await signIn(t.server);
  const wallet = user.account.address.toLowerCase() as Address;
  if (sessionId) await addPlayer(t.db, sessionId, wallet);
  return { user, wallet, socket: await connect(await ticketFor(user)) };
}

async function publish(sessionId: string, event: SessionEvent): Promise<void> {
  await t.redis.publish(sessionKeys.events(sessionId), JSON.stringify(event));
}

async function streamEntries(sessionId: string): Promise<Record<string, string>[]> {
  const entries = await t.redis.xrange(sessionKeys.actions(sessionId), "-", "+");
  return entries.map(([, fields]) => {
    const entry: Record<string, string> = {};
    for (let i = 0; i + 1 < fields.length; i += 2) entry[fields[i]!] = fields[i + 1]!;
    return entry;
  });
}

describe("session gateway", () => {
  it("lets anyone watch, with a snapshot of the current views", async () => {
    const session = await createSession(t.db, { status: "RUNNING" });
    await t.redis.set(sessionKeys.publicView(session.id), JSON.stringify({ phase: "rolling" }));
    const watcher = await connect();

    watcher.send({ type: "subscribe", sessionId: session.id });
    await expect(watcher.next("snapshot")).resolves.toMatchObject({
      sessionId: session.id,
      status: "RUNNING",
      publicView: { phase: "rolling" },
      playerView: null,
    });

    watcher.send({ type: "subscribe", sessionId: "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b" });
    await expect(watcher.next("error")).resolves.toMatchObject({ code: "NOT_FOUND" });
    watcher.send({ type: "nonsense" });
    await expect(watcher.next("error")).resolves.toMatchObject({ code: "BAD_MESSAGE" });
    watcher.send({ type: "ping", t: 5 });
    await expect(watcher.next("pong")).resolves.toMatchObject({ t: 5 });
  });

  it("identifies players by a single-use ticket", async () => {
    const user = await signIn(t.server);
    const ticket = await ticketFor(user);
    const socket = await connect(ticket);
    expect(socket).toBeDefined();
    await expect(connect(ticket)).rejects.toThrow("401");
  });

  it("queues a player's actions on the session stream", async () => {
    const session = await createSession(t.db, { status: "RUNNING" });
    const { wallet, socket } = await playerSocket(session.id);

    socket.send({ type: "action", sessionId: session.id, id: "r1", action: { type: "roll" } });
    await expect(socket.next("received")).resolves.toEqual({
      type: "received",
      sessionId: session.id,
      id: "r1",
    });
    await expect(streamEntries(session.id)).resolves.toEqual([
      { player: wallet, id: "r1", action: JSON.stringify({ type: "roll" }) },
    ]);
  });

  it("refuses actions that cannot count", async () => {
    const running = await createSession(t.db, { status: "RUNNING" });
    const upcoming = await createSession(t.db);
    const { socket, wallet } = await playerSocket(running.id);
    await addPlayer(t.db, upcoming.id, wallet);
    const outsider = await playerSocket();
    const watcher = await connect();

    const act = (
      s: typeof socket,
      sessionId: string,
      id: string,
      action: object = { type: "roll" },
    ) => s.send({ type: "action", sessionId, id, action });

    act(watcher, running.id, "w");
    await expect(watcher.next("error")).resolves.toMatchObject({
      code: "UNAUTHENTICATED",
      id: "w",
    });
    act(outsider.socket, running.id, "o");
    await expect(outsider.socket.next("error")).resolves.toMatchObject({ code: "NOT_A_PLAYER" });
    act(socket, upcoming.id, "u");
    await expect(socket.next("error")).resolves.toMatchObject({ code: "NOT_RUNNING" });
    act(socket, running.id, "x", { type: "teleport" });
    await expect(socket.next("error")).resolves.toMatchObject({ code: "INVALID_ACTION", id: "x" });
    await expect(streamEntries(running.id)).resolves.toEqual([]);
  });

  it("limits how fast one socket can act", async () => {
    const session = await createSession(t.db, { status: "RUNNING" });
    const { socket } = await playerSocket(session.id);
    for (let i = 0; i < MAX_ACTIONS_PER_SECOND + 5; i++) {
      socket.send({ type: "action", sessionId: session.id, id: `a${i}`, action: { type: "roll" } });
    }
    await expect(socket.next("error")).resolves.toMatchObject({ code: "RATE_LIMITED" });
    await expect
      .poll(async () => (await streamEntries(session.id)).length)
      .toBeLessThanOrEqual(MAX_ACTIONS_PER_SECOND + 1);
  });

  it("relays the runtime's updates, sending player views only to that player", async () => {
    const session = await createSession(t.db, { status: "RUNNING" });
    const alice = await playerSocket(session.id);
    const bob = await playerSocket(session.id);
    for (const { socket } of [alice, bob]) {
      socket.send({ type: "subscribe", sessionId: session.id });
      await socket.next("snapshot");
    }

    await publish(session.id, { kind: "public", view: { phase: "rolling", rolledPlayers: 1 } });
    await publish(session.id, {
      kind: "player",
      player: alice.wallet,
      view: { total: 9 },
      result: { id: "r1", seq: 0, accepted: true },
    });
    await publish(session.id, { kind: "status", status: "SETTLING", ranking: [] });

    for (const { socket } of [alice, bob]) {
      await expect(socket.next("public")).resolves.toMatchObject({ view: { rolledPlayers: 1 } });
      await expect(socket.next("status")).resolves.toMatchObject({ status: "SETTLING" });
    }
    await expect(alice.socket.next("player")).resolves.toMatchObject({
      view: { total: 9 },
      result: { id: "r1", accepted: true },
    });
    expect(bob.socket.messages.filter((m) => m.type === "player")).toEqual([]);

    // The status event also closes the game for new actions on this instance.
    alice.socket.send({
      type: "action",
      sessionId: session.id,
      id: "late",
      action: { type: "roll" },
    });
    await expect(alice.socket.next("error")).resolves.toMatchObject({ code: "NOT_RUNNING" });
  });
});
