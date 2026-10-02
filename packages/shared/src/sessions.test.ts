import { describe, expect, it } from "vitest";
import { NOBODY_JOINED, NOBODY_WON, endedWithoutWinners } from "./sessions.js";

describe("endedWithoutWinners", () => {
  it("is true when nobody joined or nobody scored enough", () => {
    expect(endedWithoutWinners({ status: "CANCELLED", failureReason: NOBODY_JOINED })).toBe(true);
    expect(endedWithoutWinners({ status: "FAILED", failureReason: NOBODY_WON })).toBe(true);
  });

  it("is false for real failures and host cancellations", () => {
    expect(
      endedWithoutWinners({ status: "FAILED", failureReason: "Unknown game dice@1.0.0" }),
    ).toBe(false);
    expect(endedWithoutWinners({ status: "CANCELLED", failureReason: null })).toBe(false);
    expect(endedWithoutWinners({ status: "FINALIZED", failureReason: null })).toBe(false);
  });
});
