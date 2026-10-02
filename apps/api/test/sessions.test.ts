import { hashJson, quizBankSchema } from "@fairdrops/game-kit";
import {
  SCORE_REPORT_DOMAIN,
  SCORE_REPORT_TYPES,
  createdApiKeySchema,
  errorResponseSchema,
  gameResourceViewSchema,
  pageSchema,
  membershipViewSchema,
  participantViewSchema,
  sessionViewSchema,
  type Address,
  type Hex,
} from "@fairdrops/shared";
import request from "supertest";
import type { PrivateKeyAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestApp, newAccount, signIn, type SignedIn, type TestApp } from "./harness.js";
import { CHAIN_ID, HOST, addPlayer, createSession } from "./session-fixtures.js";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.reset();
});

const participants = pageSchema(participantViewSchema);
const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

describe("sessions", () => {
  it("shows a session without its seed or result before the game ends", async () => {
    const session = await createSession(t.db);
    const body = sessionViewSchema.parse(
      (await request(t.server).get(`/sessions/${session.id}`).expect(200)).body,
    );
    expect(body).toMatchObject({
      id: session.id,
      chainId: CHAIN_ID,
      status: "SEED_COMMITTED",
      game: { id: "dice", version: "1.0.0", mode: "HOSTED" },
      playerCount: 0,
      seed: null,
      ranking: null,
      transcriptHash: null,
    });

    const byGiveaway = await request(t.server)
      .get(`/sessions/by-giveaway/${CHAIN_ID}/${session.giveawayId}`)
      .expect(200);
    expect(sessionViewSchema.parse(byGiveaway.body).id).toBe(session.id);
    await request(t.server)
      .get(`/sessions/by-giveaway/${CHAIN_ID}/0x${"f".repeat(64)}`)
      .expect(404);
    await request(t.server).get("/sessions/not-a-uuid").expect(400);
  });

  it("publishes the seed, standings and transcript once the game is over", async () => {
    const session = await createSession(t.db, { status: "SETTLING" });
    const transcript = { v: 1, mode: "HOSTED", note: "stored as published" };
    await t.db.sessionTranscript.create({
      data: { sessionId: session.id, hash: `0x${"e".repeat(64)}`, content: transcript },
    });

    const view = sessionViewSchema.parse(
      (await request(t.server).get(`/sessions/${session.id}`).expect(200)).body,
    );
    expect(view).toMatchObject({
      seed: `0x${"d".repeat(64)}`,
      ranking: [{ player: HOST, score: 7, rank: 1 }],
      transcriptHash: `0x${"e".repeat(64)}`,
    });
    const published = await request(t.server).get(`/sessions/${session.id}/transcript`).expect(200);
    expect(published.body).toEqual(transcript);
  });

  it("refuses the transcript while the game is still on", async () => {
    const session = await createSession(t.db, { status: "RUNNING" });
    const response = await request(t.server).get(`/sessions/${session.id}/transcript`).expect(409);
    expect(errorCode(response.body)).toBe("CONFLICT");
    await request(t.server)
      .get(`/sessions/0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b/transcript`)
      .expect(404);
  });
});

describe("joining", () => {
  it("adds the signed-in wallet once, and lists players", async () => {
    const session = await createSession(t.db);
    const player = await signIn(t.server);
    await request(t.server).post(`/sessions/${session.id}/join`).expect(401);

    const joined = participantViewSchema.parse(
      (
        await request(t.server)
          .post(`/sessions/${session.id}/join`)
          .set("authorization", player.bearer)
          .expect(200)
      ).body,
    );
    expect(joined.wallet).toBe(player.account.address.toLowerCase());
    await request(t.server)
      .post(`/sessions/${session.id}/join`)
      .set("authorization", player.bearer)
      .expect(200);

    const list = participants.parse(
      (await request(t.server).get(`/sessions/${session.id}/participants?limit=1`).expect(200))
        .body,
    );
    expect(list).toEqual({ items: [joined], nextCursor: null });
    await expect(t.db.sessionParticipant.count()).resolves.toBe(1);
  });

  it("tells a signed-in wallet whether it has joined", async () => {
    const session = await createSession(t.db);
    const player = await signIn(t.server);
    await request(t.server).get(`/sessions/${session.id}/me`).expect(401);
    const me = () =>
      request(t.server)
        .get(`/sessions/${session.id}/me`)
        .set("authorization", player.bearer)
        .expect(200)
        .then((response) => membershipViewSchema.parse(response.body));

    await expect(me()).resolves.toMatchObject({ joined: false, joinedAt: null });
    await request(t.server)
      .post(`/sessions/${session.id}/join`)
      .set("authorization", player.bearer)
      .expect(200);
    await expect(me()).resolves.toMatchObject({
      wallet: player.account.address.toLowerCase(),
      joined: true,
    });
  });

  it("pages through players", async () => {
    const session = await createSession(t.db);
    for (const n of [1, 2, 3]) {
      await addPlayer(t.db, session.id, `0x${n.toString().padStart(40, "0")}`);
    }
    const first = participants.parse(
      (await request(t.server).get(`/sessions/${session.id}/participants?limit=2`).expect(200))
        .body,
    );
    expect(first.items).toHaveLength(2);
    const second = participants.parse(
      (
        await request(t.server)
          .get(`/sessions/${session.id}/participants?limit=2&cursor=${first.nextCursor}`)
          .expect(200)
      ).body,
    );
    expect(second).toMatchObject({
      items: [{ wallet: `0x${"3".padStart(40, "0")}` }],
      nextCursor: null,
    });
  });

  it("closes once the game starts", async () => {
    const player = await signIn(t.server);
    for (const session of [
      await createSession(t.db, { status: "RUNNING" }),
      await createSession(t.db, { startsIn: -1_000 }),
    ]) {
      const response = await request(t.server)
        .post(`/sessions/${session.id}/join`)
        .set("authorization", player.bearer)
        .expect(409);
      expect(errorCode(response.body)).toBe("CONFLICT");
    }
  });

  it("does not let the host play in their own giveaway", async () => {
    const session = await createSession(t.db);
    await t.db.giveaway.updateMany({
      data: { host: "0x0000000000000000000000000000000000000000" },
    });
    const host = await signIn(t.server);
    await t.db.giveaway.updateMany({ data: { host: host.account.address.toLowerCase() } });
    await request(t.server)
      .post(`/sessions/${session.id}/join`)
      .set("authorization", host.bearer)
      .expect(403);
  });
});

describe("external score reports", () => {
  let developer: SignedIn;
  let reporter: PrivateKeyAccount;
  let apiKey: string;

  beforeEach(async () => {
    developer = await signIn(t.server);
    reporter = newAccount();
    await t.db.gameDefinition.create({
      data: {
        id: "racer",
        version: "1.0.0",
        name: "Racer",
        description: "",
        mode: "EXTERNAL",
        status: "APPROVED",
        configSchema: { type: "object" },
        reporterAddress: reporter.address.toLowerCase(),
        ownerId: developer.session.me.profile.id,
      },
    });
    apiKey = createdApiKeySchema.parse(
      (
        await request(t.server)
          .post("/api-keys")
          .set("authorization", developer.bearer)
          .send({ name: "Racer server", scopes: ["scores:write"] })
      ).body,
    ).secret;
  });

  const ALICE = "0x00000000000000000000000000000000000000a2" as Address;
  const BOB = "0x00000000000000000000000000000000000000b2" as Address;

  async function runningRace() {
    const session = await createSession(t.db, {
      status: "RUNNING",
      mode: "EXTERNAL",
      gameId: "racer",
    });
    await addPlayer(t.db, session.id, ALICE);
    await addPlayer(t.db, session.id, BOB);
    return session;
  }

  async function signReport(
    session: { id: string; giveawayId: string },
    ranking: { player: Address; score: number }[],
    signer = reporter,
  ) {
    const signature = await signer.signTypedData({
      domain: SCORE_REPORT_DOMAIN,
      types: SCORE_REPORT_TYPES,
      primaryType: "ScoreReport",
      message: {
        sessionId: session.id,
        chainId: BigInt(CHAIN_ID),
        giveawayId: session.giveawayId as Hex,
        rankingHash: hashJson(ranking),
        gameTranscriptHash: `0x${"0".repeat(64)}`,
      },
    });
    return { ranking, signature };
  }

  const post = (sessionId: string, body: object, key = apiKey) =>
    request(t.server).post(`/sessions/${sessionId}/score-report`).set("x-api-key", key).send(body);

  it("accepts a report signed by the game's reporter key, once", async () => {
    const session = await runningRace();
    const report = await signReport(session, [
      { player: BOB, score: 120 },
      { player: ALICE, score: 80 },
    ]);

    await post(session.id, report).expect(202);
    await expect(
      t.db.scoreReport.findUniqueOrThrow({ where: { sessionId: session.id } }),
    ).resolves.toMatchObject({
      reporter: reporter.address.toLowerCase(),
      ranking: report.ranking,
    });
    expect(errorCode((await post(session.id, report).expect(409)).body)).toBe("CONFLICT");
  });

  it("rejects reports signed by another key or naming non-players", async () => {
    const session = await runningRace();
    const forged = await signReport(session, [{ player: BOB, score: 1 }], newAccount());
    expect((await post(session.id, forged).expect(400)).body).toMatchObject({
      error: { message: "The report is not signed by the game's reporter key" },
    });

    const outsider = await signReport(session, [{ player: HOST, score: 1 }]);
    expect((await post(session.id, outsider).expect(400)).body).toMatchObject({
      error: { message: expect.stringContaining("Not players in this session") as string },
    });

    // The signature covers the ranking, so reordering it breaks the signature.
    const signed = await signReport(session, [
      { player: BOB, score: 120 },
      { player: ALICE, score: 80 },
    ]);
    await post(session.id, { ...signed, ranking: [...signed.ranking].reverse() }).expect(400);
  });

  it("only takes reports from the game's developer, for external games that are running", async () => {
    const session = await runningRace();
    const report = await signReport(session, [{ player: ALICE, score: 1 }]);

    const other = await signIn(t.server);
    const otherKey = createdApiKeySchema.parse(
      (
        await request(t.server)
          .post("/api-keys")
          .set("authorization", other.bearer)
          .send({ name: "Other", scopes: ["scores:write"] })
      ).body,
    ).secret;
    await post(session.id, report, otherKey).expect(403);
    await request(t.server).post(`/sessions/${session.id}/score-report`).send(report).expect(401);

    const hosted = await createSession(t.db, { status: "RUNNING" });
    await post(hosted.id, await signReport(hosted, [{ player: ALICE, score: 1 }])).expect(409);

    const upcoming = await createSession(t.db, { mode: "EXTERNAL", gameId: "racer" });
    await post(upcoming.id, await signReport(upcoming, [{ player: ALICE, score: 1 }])).expect(409);
  });
});

describe("game resources", () => {
  const bank = {
    v: 1,
    name: "History",
    questions: [{ prompt: "Year?", choices: ["1914", "1918"], answer: 1 }],
  };

  it("lets admins upload a question bank, stored under its hash", async () => {
    const admin = newAccount();
    t.admins.add(admin.address.toLowerCase() as Address);
    const signed = await signIn(t.server, admin);
    const upload = () =>
      request(t.server)
        .post("/game-resources")
        .set("authorization", signed.bearer)
        .send({ kind: "quiz-bank", content: bank });

    const created = gameResourceViewSchema.parse((await upload().expect(201)).body);
    expect(created).toMatchObject({
      hash: hashJson(quizBankSchema.parse(bank)),
      kind: "quiz-bank",
      summary: "History: 1 questions",
    });
    expect(gameResourceViewSchema.parse((await upload().expect(201)).body)).toEqual(created);

    const listed = z
      .array(gameResourceViewSchema)
      .parse(
        (
          await request(t.server)
            .get("/game-resources?kind=quiz-bank")
            .set("authorization", signed.bearer)
            .expect(200)
        ).body,
      );
    expect(listed).toEqual([created]);
    expect(JSON.stringify(listed)).not.toContain("1918");
  });

  it("validates content and is closed to everyone else", async () => {
    const admin = newAccount();
    t.admins.add(admin.address.toLowerCase() as Address);
    const signed = await signIn(t.server, admin);
    await request(t.server)
      .post("/game-resources")
      .set("authorization", signed.bearer)
      .send({ kind: "quiz-bank", content: { ...bank, questions: [] } })
      .expect(400);
    await request(t.server)
      .post("/game-resources")
      .set("authorization", signed.bearer)
      .send({ kind: "unknown-kind", content: bank })
      .expect(400);

    const player = await signIn(t.server);
    await request(t.server)
      .post("/game-resources")
      .set("authorization", player.bearer)
      .send({ kind: "quiz-bank", content: bank })
      .expect(403);
  });
});
