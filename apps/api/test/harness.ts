import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { resetDatabase } from "@fairdrops/db/testing";
import {
  SIGN_IN_STATEMENT,
  sessionResponseSchema,
  type Address,
  type SessionResponse,
} from "@fairdrops/shared";
import { Redis } from "ioredis";
import request from "supertest";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/app.setup.js";
import { ROLE_READER, type RoleReader } from "../src/auth/roles.service.js";
import { API_ENV, type ApiEnv } from "../src/config/env.js";
import { ChainClients } from "../src/infra/chain-clients.service.js";
import { PRISMA, type Database } from "../src/infra/prisma.module.js";
import { REDIS } from "../src/infra/redis.module.js";

export const APP_ORIGIN = "http://localhost:3000";

export interface TestApp {
  app: INestApplication;
  server: Server;
  db: Database;
  redis: Redis;
  /** Wallets the stubbed contract reports as holding DEFAULT_ADMIN_ROLE. */
  admins: Set<Address>;
  /** Replaces on-chain signature verification for contract wallets. */
  contractSignatures: { valid: boolean };
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const admins = new Set<Address>();
  const contractSignatures = { valid: false };
  const roleReader: RoleReader = {
    isDefaultAdmin: (_chainId, _contract, account) => Promise.resolve(admins.has(account)),
  };
  const chainClients = {
    get: () => ({ verifyMessage: () => Promise.resolve(contractSignatures.valid) }),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ROLE_READER)
    .useValue(roleReader)
    .overrideProvider(ChainClients)
    .useValue(chainClients)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, app.get<ApiEnv>(API_ENV));
  await app.init();

  const db = app.get<Database>(PRISMA);
  const redis = app.get<Redis>(REDIS);
  return {
    app,
    server: app.getHttpServer(),
    db,
    redis,
    admins,
    contractSignatures,
    async reset() {
      admins.clear();
      contractSignatures.valid = false;
      await resetDatabase(db);
      await redis.flushdb();
    },
    close: () => app.close(),
  };
}

export function newAccount(): PrivateKeyAccount {
  return privateKeyToAccount(generatePrivateKey());
}

export interface MessageOptions {
  statement?: string;
  origin?: string;
  chainId?: number;
  issuedAt?: Date;
  expirationTime?: Date;
  /** Sign for this address instead of the signer's own. */
  address?: Address;
}

export async function requestNonce(server: Server, address: Address): Promise<string> {
  const response = await request(server).post("/auth/nonce").send({ address }).expect(200);
  return (response.body as { nonce: string }).nonce;
}

/** Builds and signs a sign-in message the way the web app and SDK do. */
export async function signedMessage(
  server: Server,
  account: PrivateKeyAccount,
  options: MessageOptions = {},
): Promise<{ message: string; signature: `0x${string}` }> {
  const address = options.address ?? account.address;
  const origin = new URL(options.origin ?? APP_ORIGIN);
  const message = createSiweMessage({
    address,
    chainId: options.chainId ?? 84532,
    domain: origin.host,
    uri: origin.origin,
    nonce: await requestNonce(server, address),
    version: "1",
    statement: options.statement ?? SIGN_IN_STATEMENT,
    issuedAt: options.issuedAt ?? new Date(),
    expirationTime: options.expirationTime,
  });
  return { message, signature: await account.signMessage({ message }) };
}

export interface SignedIn {
  account: PrivateKeyAccount;
  session: SessionResponse;
  /** Value for the Authorization header. */
  bearer: string;
}

export async function signIn(
  server: Server,
  account: PrivateKeyAccount = newAccount(),
  options: MessageOptions = {},
): Promise<SignedIn> {
  const signed = await signedMessage(server, account, options);
  const response = await request(server)
    .post("/auth/verify")
    .send({ ...signed, transport: "body", connector: "web3auth" })
    .expect(200);
  const session = sessionResponseSchema.parse(response.body);
  return { account, session, bearer: `Bearer ${session.accessToken}` };
}
