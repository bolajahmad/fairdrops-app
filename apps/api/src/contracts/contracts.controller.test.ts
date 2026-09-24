import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  contractAbiResponseSchema,
  deployedContractSchema,
  environmentContractsResponseSchema,
  type ContractDeployment,
} from "@fairdrops/shared";
import { fairDropsAbiHash } from "@fairdrops/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { CONTRACT_DEPLOYMENTS } from "./contracts.tokens.js";

const ADDRESS = "0x32134ea591625d73d3aba7dedfe12422ab95d9dc";

function deployment(chainId: number, abiHash: string = fairDropsAbiHash): ContractDeployment {
  return {
    contract: "FairDrops",
    version: "1",
    chainId,
    address: ADDRESS,
    transactionHash: `0x${"ab".repeat(32)}`,
    blockNumber: 42,
    deployer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    salt: `0x${"cd".repeat(32)}`,
    abiHash,
    deployedAt: "2026-09-25T00:00:00.000Z",
  };
}

describe("ContractsController", () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONTRACT_DEPLOYMENTS)
      .useValue([deployment(10143), deployment(84532, `0x${"00".repeat(32)}`)])
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /contracts serves the configured environment", async () => {
    const response = await request(server).get("/contracts").expect(200);
    const body = environmentContractsResponseSchema.parse(response.body);

    expect(body.environment).toBe("testnet");
    expect(body.abiHash).toBe(fairDropsAbiHash);
    expect(body.contracts.map((c) => c.chain.key)).toEqual(["monad-testnet", "base-sepolia"]);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("GET /contracts/:environment flags deployments built from an older ABI", async () => {
    const response = await request(server).get("/contracts/testnet").expect(200);
    const body = environmentContractsResponseSchema.parse(response.body);

    expect(body.contracts.map((c) => c.abiCurrent)).toEqual([true, false]);
    expect(body.contracts[0]?.explorerUrl).toBe(`https://testnet.monadscan.com/address/${ADDRESS}`);
  });

  it("GET /contracts/:environment returns an empty list for an environment without deployments", async () => {
    const response = await request(server).get("/contracts/mainnet").expect(200);
    expect(environmentContractsResponseSchema.parse(response.body).contracts).toEqual([]);
  });

  it("GET /contracts/:environment rejects unknown environments", async () => {
    await request(server).get("/contracts/staging").expect(400);
  });

  it("GET /contracts/:environment/:chainId returns one deployment", async () => {
    const response = await request(server).get("/contracts/testnet/10143").expect(200);
    const body = deployedContractSchema.parse(response.body);
    expect(body.chainId).toBe(10143);
    expect(body.chain.nativeCurrency.symbol).toBe("MON");
  });

  it("GET /contracts/:environment/:chainId 404s for a chain outside the environment", async () => {
    await request(server).get("/contracts/mainnet/10143").expect(404);
    await request(server).get("/contracts/testnet/11155111").expect(404);
  });

  it("GET /contracts/:environment/:chainId rejects malformed chain ids", async () => {
    await request(server).get("/contracts/testnet/abc").expect(400);
    await request(server).get("/contracts/testnet/-1").expect(400);
  });

  it("GET /contracts/abi serves the current ABI", async () => {
    const response = await request(server).get("/contracts/abi").expect(200);
    const body = contractAbiResponseSchema.parse(response.body);
    expect(body.abiHash).toBe(fairDropsAbiHash);
    expect(body.abi.some((item) => item.name === "finalize")).toBe(true);
  });
});
