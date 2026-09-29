import { describe, expect, it } from "vitest";
import {
  MetadataTooLargeError,
  canonicalJson,
  decodeGiveawayMetadata,
  deriveGiveawayPhase,
  encodeGiveawayMetadata,
  rewardPolicyOf,
  rewardPolicyProblem,
  rewardPolicySchema,
  type GiveawayMetadata,
  type PhaseInput,
} from "./giveaways.js";

const metadata: GiveawayMetadata = {
  v: 1,
  title: "Friday quiz",
  description: "Five questions, top two win.",
  game: { id: "quiz", version: "1.0.0", config: { questions: 5, secondsPerQuestion: 10 } },
};

describe("canonicalJson", () => {
  it("sorts keys at every level and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(1n)).toThrow(TypeError);
  });
});

describe("giveaway metadata", () => {
  it("encodes canonically, so key order does not change the bytes", () => {
    const reordered = {
      game: metadata.game,
      description: metadata.description,
      title: metadata.title,
      v: 1 as const,
    };
    expect(encodeGiveawayMetadata(reordered).hex).toBe(encodeGiveawayMetadata(metadata).hex);
  });

  it("round-trips through the on-chain encoding", () => {
    const { hex } = encodeGiveawayMetadata(metadata);
    expect(decodeGiveawayMetadata(hex)).toEqual({ ok: true, metadata });
  });

  it("refuses documents larger than the contract accepts", () => {
    const huge = { ...metadata, game: { ...metadata.game, config: { blob: "x".repeat(5000) } } };
    expect(() => encodeGiveawayMetadata(huge)).toThrow(MetadataTooLargeError);
  });

  it("reports why emitted bytes are unusable instead of throwing", () => {
    const toHex = (s: string) => `0x${Buffer.from(s, "utf8").toString("hex")}` as const;
    expect(decodeGiveawayMetadata("0xzz")).toMatchObject({ ok: false });
    expect(decodeGiveawayMetadata(toHex("not json"))).toEqual({
      ok: false,
      error: "Metadata is not UTF-8 JSON",
    });
    expect(decodeGiveawayMetadata(toHex('{"v":2}'))).toMatchObject({ ok: false });
    expect(decodeGiveawayMetadata(toHex(JSON.stringify({ ...metadata, extra: 1 })))).toMatchObject({
      ok: false,
    });
    expect(decodeGiveawayMetadata(new Uint8Array([0xff, 0xfe]))).toEqual({
      ok: false,
      error: "Metadata is not UTF-8 JSON",
    });
  });
});

describe("deriveGiveawayPhase", () => {
  const base: PhaseInput = {
    status: "ACTIVE",
    metadataValid: true,
    startTime: new Date("2026-10-01T12:00:00Z"),
    finalizeDeadline: new Date("2026-10-02T12:00:00Z"),
    claimDeadline: null,
    sessionStatus: null,
  };
  const at = (iso: string) => new Date(iso);

  it("follows an active giveaway through its schedule", () => {
    expect(deriveGiveawayPhase(base, at("2026-10-01T11:00:00Z"))).toBe("upcoming");
    expect(
      deriveGiveawayPhase({ ...base, sessionStatus: "RUNNING" }, at("2026-10-01T12:30:00Z")),
    ).toBe("live");
    expect(
      deriveGiveawayPhase({ ...base, sessionStatus: "SETTLING" }, at("2026-10-01T13:00:00Z")),
    ).toBe("settling");
    expect(deriveGiveawayPhase(base, at("2026-10-02T12:00:01Z"))).toBe("expired");
  });

  it("flags invalid metadata before anything else on an active giveaway", () => {
    expect(deriveGiveawayPhase({ ...base, metadataValid: false }, at("2026-10-01T11:00:00Z"))).toBe(
      "invalid",
    );
  });

  it("maps terminal chain states", () => {
    const claimDeadline = new Date("2026-11-01T00:00:00Z");
    const finalized = { ...base, status: "FINALIZED" as const, claimDeadline };
    expect(deriveGiveawayPhase(finalized, at("2026-10-15T00:00:00Z"))).toBe("claimable");
    expect(deriveGiveawayPhase(finalized, at("2026-11-01T00:00:01Z"))).toBe("closed");
    expect(deriveGiveawayPhase({ ...base, status: "CANCELLED" })).toBe("cancelled");
    expect(deriveGiveawayPhase({ ...base, status: "EXPIRED" })).toBe("expired");
  });
});

describe("reward policies", () => {
  it("round-trips v2 metadata and fills in the default minimum score", () => {
    const v2 = { ...metadata, v: 2 as const, rewards: { kind: "equal" as const, winners: 2 } };
    const decoded = decodeGiveawayMetadata(encodeGiveawayMetadata(v2).hex);
    expect(decoded).toEqual({
      ok: true,
      metadata: { ...v2, rewards: { kind: "equal", winners: 2, minScore: 1 } },
    });
  });

  it("requires weighted shares to sum to 10000", () => {
    expect(rewardPolicySchema.safeParse({ kind: "weighted", bps: [6000, 4000] }).success).toBe(
      true,
    );
    expect(rewardPolicySchema.safeParse({ kind: "weighted", bps: [6000, 3000] }).success).toBe(
      false,
    );
    expect(rewardPolicySchema.safeParse({ kind: "weighted", bps: [10000, 0] }).success).toBe(false);
  });

  it("gives v1 giveaways an equal split between maxWinners places", () => {
    expect(rewardPolicyOf(metadata, 3)).toEqual({ kind: "equal", winners: 3, minScore: 1 });
  });

  it("refuses policies with more places than the giveaway has winners", () => {
    const policy = rewardPolicySchema.parse({ kind: "weighted", bps: [5000, 3000, 2000] });
    expect(rewardPolicyProblem(policy, 3)).toBeNull();
    expect(rewardPolicyProblem(policy, 2)).toMatch(/pays 3 places/);
  });
});
