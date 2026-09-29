import {
  gameDefinitionStatusSchema,
  gameModeSchema,
  giveawayEventKindSchema,
  onchainStatusSchema,
  sessionStatusSchema,
  socialPlatformSchema,
  walletConnectorSchema,
  walletKindSchema,
} from "@fairdrops/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  GameDefinitionStatus,
  GameMode,
  GiveawayEventKind,
  OnchainStatus,
  SessionStatus,
  SocialPlatform,
  WalletConnector,
  WalletKind,
  createPrismaClient,
} from "../src/index.js";
import { DEFAULT_TEST_DATABASE_URL, resetDatabase } from "../src/testing.js";

const prisma = createPrismaClient({
  connectionString: process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL,
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

describe("database enums", () => {
  it.each([
    ["WalletKind", WalletKind, walletKindSchema.options],
    ["WalletConnector", WalletConnector, walletConnectorSchema.options],
    ["SocialPlatform", SocialPlatform, socialPlatformSchema.options],
    ["GameMode", GameMode, gameModeSchema.options],
    ["GameDefinitionStatus", GameDefinitionStatus, gameDefinitionStatusSchema.options],
    ["OnchainStatus", OnchainStatus, onchainStatusSchema.options],
    ["GiveawayEventKind", GiveawayEventKind, giveawayEventKindSchema.options],
    ["SessionStatus", SessionStatus, sessionStatusSchema.options],
  ] as const)("%s matches @fairdrops/shared", (_name, prismaEnum, sharedValues) => {
    expect(Object.values(prismaEnum).sort()).toEqual([...sharedValues].sort());
  });
});

describe("format constraints", () => {
  it("rejects a checksummed (non-lowercase) wallet address", async () => {
    const user = await prisma.user.create({ data: {} });
    await expect(
      prisma.wallet.create({
        data: {
          address: "0x40E79f68ae9AD9A28942050c5158A26d9c9e60CA",
          userId: user.id,
          kind: "EOA",
        },
      }),
    ).rejects.toThrow(/wallets_address_format/);
  });

  it("rejects malformed handles", async () => {
    await expect(prisma.user.create({ data: { handle: "No Spaces" } })).rejects.toThrow(
      /users_handle_format/,
    );
  });

  it("rejects unknown API key scopes", async () => {
    const user = await prisma.user.create({ data: {} });
    await expect(
      prisma.apiKey.create({
        data: {
          userId: user.id,
          name: "bad",
          prefix: "fd_live_abcd",
          secretHash: "a".repeat(64),
          scopes: ["everything"],
        },
      }),
    ).rejects.toThrow(/api_keys_scopes_known/);
  });

  it("requires a reporter address exactly for external games", async () => {
    const owner = await prisma.user.create({ data: {} });
    const base = {
      id: "quiz",
      version: "1.0.0",
      name: "Quiz",
      description: "",
      configSchema: { type: "object" },
      ownerId: owner.id,
    };
    await expect(
      prisma.gameDefinition.create({ data: { ...base, mode: "EXTERNAL" } }),
    ).rejects.toThrow(/game_definitions_mode_fields/);
    await expect(
      prisma.gameDefinition.create({
        data: {
          ...base,
          mode: "HOSTED",
          reporterAddress: "0x0000000000000000000000000000000000000001",
        },
      }),
    ).rejects.toThrow(/game_definitions_mode_fields/);
    await expect(
      prisma.gameDefinition.create({ data: { ...base, mode: "HOSTED" } }),
    ).resolves.toMatchObject({
      status: "DRAFT",
    });
  });

  it("generates time-ordered UUIDv7 ids", async () => {
    const first = await prisma.user.create({ data: {} });
    const second = await prisma.user.create({ data: {} });
    expect(first.id[14]).toBe("7");
    expect(first.id < second.id).toBe(true);
  });
});

describe("on-chain invariants", () => {
  const hash = (char: string) => `0x${char.repeat(64)}`;
  const giveaway = {
    chainId: 10143,
    giveawayId: hash("1"),
    contractAddress: "0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca",
    host: "0x00000000000000000000000000000000000000a1",
    token: "0x0000000000000000000000000000000000000000",
    prize: "990",
    fee: "10",
    startTime: new Date("2026-10-01T00:00:00Z"),
    finalizeDeadline: new Date("2026-10-02T00:00:00Z"),
    maxWinners: 3,
    claimWindowSeconds: 2_592_000,
    metadataHash: hash("a"),
    metadataRaw: new Uint8Array([123, 125]),
    metadataError: "Metadata is not a valid document",
    createdBlock: 100n,
    createdTxHash: hash("b"),
    createdAt: new Date("2026-09-28T00:00:00Z"),
    updatedBlock: 100n,
  };

  it("accepts a well-formed giveaway", async () => {
    await expect(prisma.giveaway.create({ data: giveaway })).resolves.toMatchObject({
      status: "ACTIVE",
    });
  });

  it("rejects a payout above the escrowed prize", async () => {
    await expect(
      prisma.giveaway.create({ data: { ...giveaway, totalPayout: "991" } }),
    ).rejects.toThrow(/giveaways_payout_within_prize/);
  });

  it("rejects claims above the signed total payout", async () => {
    await prisma.giveaway.create({ data: giveaway });
    await expect(
      prisma.giveaway.update({
        where: { chainId_giveawayId: { chainId: 10143, giveawayId: hash("1") } },
        data: { claimed: "1" },
      }),
    ).rejects.toThrow(/giveaways_claimed_within_payout/);
  });

  it("requires the settlement fields exactly when finalized", async () => {
    await expect(
      prisma.giveaway.create({ data: { ...giveaway, status: "FINALIZED" } }),
    ).rejects.toThrow(/giveaways_finalized_fields/);
  });

  it("requires either a parsed document or the reason it was rejected", async () => {
    await expect(
      prisma.giveaway.create({ data: { ...giveaway, metadataError: null } }),
    ).rejects.toThrow(/giveaways_metadata_parsed/);
  });
});

describe("session invariants", () => {
  const hash = (char: string) => `0x${char.repeat(64)}`;

  async function giveaway() {
    return prisma.giveaway.create({
      data: {
        chainId: 84532,
        giveawayId: hash("2"),
        contractAddress: "0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca",
        host: "0x00000000000000000000000000000000000000a1",
        token: "0x0000000000000000000000000000000000000000",
        prize: "1000",
        fee: "10",
        startTime: new Date("2026-10-01T00:00:00Z"),
        finalizeDeadline: new Date("2026-10-02T00:00:00Z"),
        maxWinners: 3,
        claimWindowSeconds: 2_592_000,
        metadataHash: hash("a"),
        metadataRaw: new Uint8Array([123, 125]),
        metadata: {},
        createdBlock: 1n,
        createdTxHash: hash("b"),
        createdAt: new Date("2026-09-28T00:00:00Z"),
        updatedBlock: 1n,
      },
    });
  }

  const session = {
    chainId: 84532,
    giveawayId: hash("2"),
    gameId: "quiz",
    gameVersion: "1.0.0",
    mode: "HOSTED" as const,
    config: {},
    seedCiphertext: new Uint8Array(60),
    seedCommitment: hash("c"),
    startsAt: new Date("2026-10-01T00:00:00Z"),
    endsAt: new Date("2026-10-01T00:10:00Z"),
  };

  it("allows one session per giveaway", async () => {
    await giveaway();
    await prisma.gameSession.create({ data: session });
    await expect(prisma.gameSession.create({ data: session })).rejects.toThrow(/Unique constraint/);
  });

  it("requires the result, seed and end time exactly once the game is over", async () => {
    await giveaway();
    const created = await prisma.gameSession.create({
      data: { ...session, status: "RUNNING", startedAt: new Date() },
    });
    await expect(
      prisma.gameSession.update({ where: { id: created.id }, data: { status: "SETTLING" } }),
    ).rejects.toThrow(/game_sessions_result/);
  });

  it("only lets failed sessions have an unknown game, and requires a reason", async () => {
    await giveaway();
    await expect(prisma.gameSession.create({ data: { ...session, mode: null } })).rejects.toThrow(
      /game_sessions_unknown_game_failed/,
    );
    await expect(
      prisma.gameSession.create({ data: { ...session, mode: null, status: "FAILED" } }),
    ).rejects.toThrow(/game_sessions_failure_reason/);
  });
});
