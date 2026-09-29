/**
 * The SDK against the real API over HTTP and WebSocket: every response it receives is validated
 * by the same shared schemas the API is written against, so this suite fails if the two drift.
 * The chain is the one thing stood in for (a fake public client for verification).
 */
import type { AddressInfo } from "node:net";
import type { Prisma } from "@fairdrops/db";
import { FairDrops, FairDropsError } from "@fairdrops/sdk";
import { LiveConnection } from "@fairdrops/sdk/live";
import { ScoreReporter } from "@fairdrops/sdk/server";
import { verifyGiveaway } from "@fairdrops/sdk/verify";
import { createdApiKeySchema, sessionKeys, type Address, type Hex } from "@fairdrops/shared";
import request from "supertest";
import type { PublicClient } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APP_ORIGIN, createTestApp, newAccount, signIn, type TestApp } from "./harness.js";
import { CHAIN_ID, addPlayer, createSession } from "./session-fixtures.js";
import { createSettledGiveaway } from "./settlement-fixtures.js";

let t: TestApp;
let apiUrl: string;
const open: LiveConnection[] = [];

beforeAll(async () => {
  t = await createTestApp();
  await new Promise<void>((resolve) => t.server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(t.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const live of open) live.close();
  await t.close();
});

beforeEach(async () => {
  for (const live of open.splice(0)) live.close();
  await t.reset();
});

const client = () => new FairDrops({ apiUrl, origin: APP_ORIGIN });

/** The chain as `verifyGiveaway` reads it, built from what the fixture put on "chain". */
async function chainFor(chainId: number, giveawayId: Hex): Promise<PublicClient> {
  const g = await t.db.giveaway.findUniqueOrThrow({
    where: { chainId_giveawayId: { chainId, giveawayId } },
  });
  const status = { ACTIVE: 1, FINALIZED: 2, CANCELLED: 3, EXPIRED: 4 }[g.status];
  const { keccak256 } = await import("viem");
  const readContract = ({ functionName }: { functionName: string }) => {
    if (functionName !== "getGiveaway") throw new Error(functionName);
    return Promise.resolve({
      status,
      prize: BigInt(g.prize.toFixed()),
      maxWinners: g.maxWinners,
      metadataHash: keccak256(g.metadataRaw),
      seedCommitment: g.seedCommitment,
      payoutRoot: g.payoutRoot ?? `0x${"0".repeat(64)}`,
      totalPayout: BigInt(g.totalPayout.toFixed()),
      winnerCount: g.winnerCount,
      transcriptHash: g.transcriptHash ?? `0x${"0".repeat(64)}`,
    });
  };
  return { readContract } as unknown as PublicClient;
}

describe("SDK against the API", () => {
  it("signs in with SIWE, refreshes and signs out", async () => {
    const fd = client();
    const account = newAccount();
    const me = await fd.auth.signIn(account);
    expect(me.wallet).toBe(account.address.toLowerCase());
    expect(fd.auth.isSignedIn()).toBe(true);

    // Force a refresh by expiring the stored access token.
    const stored = fd.http.tokens.get()!;
    fd.http.tokens.set({ ...stored, accessTokenExpiresAt: new Date(0).toISOString() });
    expect((await fd.auth.me()).wallet).toBe(me.wallet);
    expect(fd.http.tokens.get()!.refreshToken).not.toBe(stored.refreshToken);

    await fd.auth.signOut();
    expect(fd.auth.isSignedIn()).toBe(false);
    await expect(fd.auth.me()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("refuses to sign in from an origin FairDrops does not know", async () => {
    const fd = new FairDrops({ apiUrl, origin: "https://evil.example" });
    const error = await fd.auth.signIn(newAccount()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FairDropsError);
    expect(error).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("joins a game and follows it live", async () => {
    const fd = client();
    const account = newAccount();
    await fd.auth.signIn(account);
    const session = await createSession(t.db, { status: "LOBBY" });

    await fd.sessions.join(session.id);
    const players = await fd.sessions.participants(session.id);
    expect(players.map((p) => p.wallet)).toEqual([account.address.toLowerCase()]);

    const live = await LiveConnection.connect(fd, { pingIntervalMs: 50 });
    open.push(live);
    expect(live.wallet).toBe(account.address.toLowerCase());
    const room = live.subscribe(session.id);
    await new Promise<void>((resolve) => room.on("snapshot", () => resolve()));
    expect(room.status).toBe("LOBBY");

    // Acting before the start is refused by the gateway, and the promise rejects.
    await expect(room.act({ type: "roll" })).rejects.toMatchObject({ code: "NOT_RUNNING" });

    // Status changes published by the worker reach the room.
    const started = new Promise<string>((resolve) => room.on("status", (e) => resolve(e.status)));
    await t.redis.publish(
      sessionKeys.events(session.id),
      JSON.stringify({ kind: "status", status: "RUNNING" }),
    );
    await expect(started).resolves.toBe("RUNNING");

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(live.roundTripMs).not.toBeNull();
  });

  it("reads giveaways, results and claims, and verifies a result independently", async () => {
    const fd = client();
    const winner = newAccount();
    const address = winner.address.toLowerCase() as Address;
    const { giveawayId, sessionId, computed } = await createSettledGiveaway(t.db, {
      players: [address, "0x00000000000000000000000000000000000000b2"],
      status: "CONFIRMED",
    });

    const listed = await fd.giveaways.list({ chainId: CHAIN_ID });
    expect(listed.items.map((g) => g.giveawayId)).toContain(giveawayId);
    const giveaway = await fd.giveaways.get(CHAIN_ID, giveawayId);
    expect(giveaway.phase).toBe("claimable");
    expect((await fd.sessions.byGiveaway(CHAIN_ID, giveawayId)).id).toBe(sessionId);
    expect((await fd.settlement.get(sessionId)).payoutRoot).toBe(computed.payoutRoot);

    const won = computed.payouts.find((p) => p.account === address);
    if (won) {
      const claim = await fd.claims.get(CHAIN_ID, giveawayId, address);
      expect(claim).toMatchObject({ amount: won.amount.toString(), claimable: true });
      await fd.auth.signIn(winner);
      expect((await fd.claims.mine()).map((c) => c.giveawayId)).toEqual([giveawayId]);
    }

    const verification = await verifyGiveaway(fd, CHAIN_ID, giveawayId, {
      publicClient: await chainFor(CHAIN_ID, giveawayId),
    });
    expect(verification.checks.filter((c) => !c.ok)).toEqual([]);
    expect(verification).toMatchObject({ ok: true, against: "onchain", status: "Finalized" });
  });

  it("catches a transcript that does not match what was settled on-chain", async () => {
    const fd = client();
    const { giveawayId, sessionId, transcript } = await createSettledGiveaway(t.db, {
      players: [
        "0x00000000000000000000000000000000000000a1",
        "0x00000000000000000000000000000000000000b2",
      ],
      status: "CONFIRMED",
    });
    const forged = { ...transcript, actions: transcript.actions.slice(1) };
    await t.db.sessionTranscript.update({
      where: { sessionId },
      data: { content: forged as Prisma.InputJsonValue },
    });

    const verification = await verifyGiveaway(fd, CHAIN_ID, giveawayId, {
      publicClient: await chainFor(CHAIN_ID, giveawayId),
    });
    expect(verification.ok).toBe(false);
    expect(verification.checks.filter((c) => !c.ok).map((c) => c.name)).toContain("transcriptHash");
  });

  it("reports an external game's result from its server", async () => {
    const developer = await signIn(t.server);
    const reporterKey = newAccount();
    await t.db.gameDefinition.create({
      data: {
        id: "racer",
        version: "1.0.0",
        name: "Racer",
        description: "",
        mode: "EXTERNAL",
        status: "APPROVED",
        configSchema: { type: "object" },
        reporterAddress: reporterKey.address.toLowerCase(),
        ownerId: developer.session.me.profile.id,
      },
    });
    const apiKey = createdApiKeySchema.parse(
      (
        await request(t.server)
          .post("/api-keys")
          .set("authorization", developer.bearer)
          .send({ name: "Racer server", scopes: ["scores:write"] })
      ).body,
    ).secret;
    const session = await createSession(t.db, {
      status: "RUNNING",
      mode: "EXTERNAL",
      gameId: "racer",
    });
    const alice = "0x00000000000000000000000000000000000000a2" as Address;
    const bob = "0x00000000000000000000000000000000000000b2" as Address;
    await addPlayer(t.db, session.id, alice);
    await addPlayer(t.db, session.id, bob);

    const reporter = new ScoreReporter({ apiUrl, apiKey, reporter: reporterKey });
    expect((await reporter.players(session.id)).map((p) => p.wallet).sort()).toEqual([alice, bob]);
    await reporter.report(session.id, [
      { player: bob, score: 90 },
      { player: alice, score: 40 },
    ]);
    const stored = await t.db.scoreReport.findUniqueOrThrow({ where: { sessionId: session.id } });
    expect(stored.ranking).toEqual([
      { player: bob, score: 90 },
      { player: alice, score: 40 },
    ]);

    // A key that is not the game's reporter is refused.
    const impostor = new ScoreReporter({ apiUrl, apiKey, reporter: newAccount() });
    const other = await createSession(t.db, {
      status: "RUNNING",
      mode: "EXTERNAL",
      gameId: "racer",
    });
    await addPlayer(t.db, other.id, alice);
    await expect(impostor.report(other.id, [{ player: alice, score: 1 }])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
