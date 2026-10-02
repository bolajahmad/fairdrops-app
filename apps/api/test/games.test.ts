import { DEFAULT_QUIZ_BANK_HASH, fairDropsMix } from "@fairdrops/game-kit";
import {
  errorResponseSchema,
  gameDefinitionViewSchema,
  pageSchema,
  type Address,
} from "@fairdrops/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestApp,
  newAccount,
  signIn,
  signedMessage,
  type SignedIn,
  type TestApp,
} from "./harness.js";

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

const gamePage = pageSchema(gameDefinitionViewSchema);

const quiz = {
  id: "quiz",
  version: "1.0.0",
  mode: "HOSTED",
  name: "Quiz",
  description: "Multiple choice questions.",
  configSchema: { type: "object", properties: { questions: { type: "integer", minimum: 1 } } },
};

async function admin(): Promise<SignedIn> {
  const account = newAccount();
  t.admins.add(account.address.toLowerCase() as Address);
  return signIn(t.server, account);
}

async function create(dev: SignedIn, body: object = quiz) {
  return request(t.server).post("/games").set("authorization", dev.bearer).send(body);
}

async function act(user: SignedIn, action: string, path = "quiz/1.0.0", body: object = {}) {
  return request(t.server)
    .post(`/games/${path}/${action}`)
    .set("authorization", user.bearer)
    .send(body);
}

describe("game definitions", () => {
  it("creates a draft that only its owner can see", async () => {
    const dev = await signIn(t.server);
    const response = await create(dev);
    expect(response.status).toBe(201);
    expect(gameDefinitionViewSchema.parse(response.body)).toMatchObject({
      status: "DRAFT",
      mode: "HOSTED",
    });

    await request(t.server).get("/games/quiz/1.0.0").set("authorization", dev.bearer).expect(200);
    await request(t.server).get("/games/quiz/1.0.0").expect(404);
    const stranger = await signIn(t.server);
    await request(t.server)
      .get("/games/quiz/1.0.0")
      .set("authorization", stranger.bearer)
      .expect(404);
  });

  it("reserves a game id for the developer who registered it", async () => {
    const dev = await signIn(t.server);
    await create(dev);
    expect((await create(dev)).status).toBe(409);
    expect((await create(dev, { ...quiz, version: "1.1.0" })).status).toBe(201);

    const squatter = await signIn(t.server);
    expect((await create(squatter, { ...quiz, version: "2.0.0" })).status).toBe(403);
  });

  it("requires a reporter key for external games", async () => {
    const dev = await signIn(t.server);
    expect((await create(dev, { ...quiz, id: "remote-game", mode: "EXTERNAL" })).status).toBe(400);
    const response = await create(dev, {
      ...quiz,
      id: "remote-game",
      mode: "EXTERNAL",
      reporterAddress: newAccount().address,
    });
    expect(response.status).toBe(201);

    const clear = await request(t.server)
      .patch("/games/remote-game/1.0.0")
      .set("authorization", dev.bearer)
      .send({ reporterAddress: null })
      .expect(400);
    expect(errorResponseSchema.parse(clear.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("goes through review before anyone else can see it", async () => {
    const dev = await signIn(t.server);
    const reviewer = await admin();
    await create(dev);

    await request(t.server)
      .patch("/games/quiz/1.0.0")
      .set("authorization", dev.bearer)
      .send({ description: "Five rounds of questions." })
      .expect(200);
    expect((await act(dev, "submit")).status).toBe(200);
    expect((await act(dev, "submit")).status).toBe(409);
    await request(t.server)
      .patch("/games/quiz/1.0.0")
      .set("authorization", dev.bearer)
      .send({ name: "Changed after submitting" })
      .expect(409);

    const queue = await request(t.server)
      .get("/games/review-queue")
      .set("authorization", reviewer.bearer)
      .expect(200);
    expect(gamePage.parse(queue.body).items.map((g) => g.id)).toEqual(["quiz"]);

    expect((await act(dev, "approve")).status).toBe(403);
    const approved = await act(reviewer, "approve", "quiz/1.0.0", { note: "Looks good" });
    expect(gameDefinitionViewSchema.parse(approved.body)).toMatchObject({
      status: "APPROVED",
      reviewNote: "Looks good",
    });

    const listed = await request(t.server).get("/games").expect(200);
    expect(gamePage.parse(listed.body).items.map((g) => `${g.id}@${g.version}`)).toEqual([
      "quiz@1.0.0",
    ]);
    await request(t.server).get("/games/quiz/1.0.0").expect(200);

    expect((await act(reviewer, "disable")).status).toBe(200);
    const disabled = await request(t.server).get("/games/quiz/1.0.0").expect(200);
    expect(gameDefinitionViewSchema.parse(disabled.body).status).toBe("DISABLED");
  });

  it("returns rejected games to draft with the reviewer's note", async () => {
    const dev = await signIn(t.server);
    const reviewer = await admin();
    await create(dev);
    await act(dev, "submit");
    const rejected = await act(reviewer, "reject", "quiz/1.0.0", {
      note: "Add a description of scoring",
    });
    expect(gameDefinitionViewSchema.parse(rejected.body)).toMatchObject({
      status: "DRAFT",
      reviewNote: "Add a description of scoring",
    });
  });

  it("lets exactly one of two concurrent approvals win", async () => {
    const dev = await signIn(t.server);
    const [first, second] = [await admin(), await admin()];
    await create(dev);
    await act(dev, "submit");

    const statuses = (await Promise.all([act(first, "approve"), act(second, "approve")])).map(
      (r) => r.status,
    );
    expect(statuses.sort()).toEqual([200, 409]);
  });

  it("does not trust a stale admin claim once the role is revoked on-chain", async () => {
    const dev = await signIn(t.server);
    const reviewer = await admin();
    await create(dev);
    await act(dev, "submit");

    t.admins.clear();
    await t.redis.flushdb();
    expect((await act(reviewer, "approve")).status).toBe(403);
  });

  it("pages through the owner's games with a cursor", async () => {
    const dev = await signIn(t.server);
    for (const version of ["1.0.0", "1.1.0", "2.0.0"]) await create(dev, { ...quiz, version });

    const first = gamePage.parse(
      (
        await request(t.server)
          .get("/games?owner=mine&limit=2")
          .set("authorization", dev.bearer)
          .expect(200)
      ).body,
    );
    expect(first.items.map((g) => g.version)).toEqual(["1.0.0", "1.1.0"]);
    expect(first.nextCursor).not.toBeNull();

    const second = gamePage.parse(
      (
        await request(t.server)
          .get(`/games?owner=mine&limit=2&cursor=${first.nextCursor}`)
          .set("authorization", dev.bearer)
          .expect(200)
      ).body,
    );
    expect(second.items.map((g) => g.version)).toEqual(["2.0.0"]);
    expect(second.nextCursor).toBeNull();

    await request(t.server).get("/games?owner=mine").expect(401);
    await request(t.server).get("/games?status=DRAFT").expect(403);
  });

  it("allows players to sign in from an approved game's UI origin", async () => {
    const dev = await signIn(t.server);
    const reviewer = await admin();
    await create(dev, { ...quiz, uiUrl: "https://play.quiz-studio.example/game" });
    const gameOrigin = "https://play.quiz-studio.example";

    const before = await signedMessage(t.server, newAccount(), { origin: gameOrigin });
    await request(t.server).post("/auth/verify").send(before).expect(401);

    await act(dev, "submit");
    await act(reviewer, "approve");
    const after = await signedMessage(t.server, newAccount(), { origin: gameOrigin });
    await request(t.server).post("/auth/verify").send(after).expect(200);
  });
});

describe("quiz banks", () => {
  it("lists banks publicly by name and size, never their questions", async () => {
    const owner = await t.db.user.create({ data: {} });
    await t.db.gameResource.create({
      data: {
        hash: DEFAULT_QUIZ_BANK_HASH,
        kind: "quiz-bank",
        summary: "FairDrops mix: 100 questions",
        content: fairDropsMix,
        createdById: owner.id,
      },
    });
    const response = await request(t.server).get("/quiz-banks").expect(200);
    expect(response.body).toEqual([
      { hash: DEFAULT_QUIZ_BANK_HASH, name: "FairDrops mix", questions: 100, builtin: true },
    ]);
    expect(JSON.stringify(response.body)).not.toContain(fairDropsMix.questions[0]!.prompt);
  });
});
