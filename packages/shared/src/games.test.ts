import { describe, expect, it } from "vitest";
import { createGameDefinitionRequestSchema, gameIdSchema, modeFieldIssues } from "./games.js";

const hosted = {
  id: "quiz",
  version: "1.0.0",
  mode: "HOSTED",
  name: "Quiz",
  description: "Multiple choice questions.",
  configSchema: { type: "object", properties: { questions: { type: "integer" } } },
};

describe("game definitions", () => {
  it("validates slugs", () => {
    expect(gameIdSchema.safeParse("tap-race").success).toBe(true);
    expect(gameIdSchema.safeParse("-bad").success).toBe(false);
    expect(gameIdSchema.safeParse("Quiz").success).toBe(false);
  });

  it("fills optional fields with null", () => {
    expect(createGameDefinitionRequestSchema.parse(hosted)).toMatchObject({
      uiUrl: null,
      reporterAddress: null,
      codeHash: null,
    });
  });

  it("requires a reporter key for external games and forbids one for hosted games", () => {
    expect(
      createGameDefinitionRequestSchema.safeParse({ ...hosted, mode: "EXTERNAL" }).success,
    ).toBe(false);
    const reporterAddress = "0x0000000000000000000000000000000000000001";
    expect(
      createGameDefinitionRequestSchema.safeParse({ ...hosted, mode: "EXTERNAL", reporterAddress })
        .success,
    ).toBe(true);
    expect(modeFieldIssues({ mode: "HOSTED", reporterAddress })).toHaveLength(1);
  });

  it("requires an object config schema", () => {
    expect(
      createGameDefinitionRequestSchema.safeParse({ ...hosted, configSchema: { type: "string" } })
        .success,
    ).toBe(false);
  });
});
