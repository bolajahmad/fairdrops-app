import { DEFAULT_QUIZ_BANK_HASH } from "@fairdrops/game-kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BuiltinCatalog, SYSTEM_USER_ID } from "../src/sessions/builtin-catalog.js";
import { createGiveaway, createHarness, sessionFor, type Harness } from "./sessions-harness.js";

let h: Harness;
let catalog: BuiltinCatalog;

beforeAll(async () => {
  h = await createHarness();
  catalog = h.moduleRef.get(BuiltinCatalog);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

describe("built-in catalog", () => {
  it("registers Dice, Quiz, Rounds and the default question bank as approved, once", async () => {
    await catalog.sync();
    await catalog.sync();
    const games = await h.db.gameDefinition.findMany({ orderBy: { id: "asc" } });
    expect(games.map((game) => [game.id, game.status, game.ownerId])).toEqual([
      ["dice", "APPROVED", SYSTEM_USER_ID],
      ["quiz", "APPROVED", SYSTEM_USER_ID],
      ["rounds", "APPROVED", SYSTEM_USER_ID],
    ]);
    const bank = await h.db.gameResource.findUniqueOrThrow({
      where: { hash: DEFAULT_QUIZ_BANK_HASH },
    });
    expect(bank.summary).toBe("FairDrops mix: 100 questions");
  });

  it("never re-approves a built-in game an admin disabled", async () => {
    await catalog.sync();
    await h.db.gameDefinition.update({
      where: { id_version: { id: "dice", version: "1.0.0" } },
      data: { status: "DISABLED" },
    });
    await catalog.sync();
    const dice = await h.db.gameDefinition.findUniqueOrThrow({
      where: { id_version: { id: "dice", version: "1.0.0" } },
    });
    expect(dice.status).toBe("DISABLED");
  });

  it("lets a giveaway that failed only because Dice was unregistered be planned again", async () => {
    const giveawayId = await createGiveaway(h.db, { game: { id: "dice" } });
    await h.planner.createSessions();
    expect(await sessionFor(h.db, giveawayId)).toMatchObject({
      status: "FAILED",
      failureReason: "Unknown game dice@1.0.0",
    });

    await catalog.sync();
    await h.planner.createSessions();
    expect(await sessionFor(h.db, giveawayId)).toMatchObject({
      status: "SCHEDULED",
      mode: "HOSTED",
    });
  });

  it("plans a quiz that names the default bank", async () => {
    await catalog.sync();
    const giveawayId = await createGiveaway(h.db, {
      game: { id: "quiz", config: { bank: DEFAULT_QUIZ_BANK_HASH, questions: 10 } },
    });
    await h.planner.createSessions();
    expect(await sessionFor(h.db, giveawayId)).toMatchObject({ status: "SCHEDULED" });
  });
});
