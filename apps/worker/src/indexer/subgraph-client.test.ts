import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HttpSubgraphClient, SubgraphError } from "./subgraph-client.js";

interface Received {
  authorization: string | undefined;
  body: { query: string; variables: Record<string, unknown> };
}

let server: Server;
let endpoint: string;
let reply: { status: number; body: unknown; headers?: Record<string, string> };
let received: Received[];

const meta = { block: { number: 120 }, deployment: "QmDeployment", hasIndexingErrors: false };

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

beforeAll(async () => {
  server = createServer((request, response) => {
    void readBody(request).then((body) => {
      received.push({
        authorization: request.headers.authorization,
        body: JSON.parse(body) as Received["body"],
      });
      response.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gn`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received = [];
  reply = { status: 200, body: { data: { _meta: meta } } };
});

describe("HttpSubgraphClient", () => {
  it("reads the subgraph head", async () => {
    await expect(new HttpSubgraphClient(endpoint).meta()).resolves.toEqual({
      block: 120n,
      deployment: "QmDeployment",
      hasIndexingErrors: false,
    });
    expect(received[0]!.authorization).toBeUndefined();
  });

  it("queries events after the cursor, up to the safe block, with the API token", async () => {
    reply.body = {
      data: { _meta: meta, anchor: { blockHash: `0x${"a".repeat(64)}` }, events: [] },
    };
    const client = new HttpSubgraphClient(endpoint, "token-1");

    const batch = await client.events({
      after: "0x000000000000006400000000",
      maxBlock: 119n,
      first: 50,
    });

    expect(batch).toEqual({
      meta: { block: 120n, deployment: "QmDeployment", hasIndexingErrors: false },
      anchorBlockHash: `0x${"a".repeat(64)}`,
      events: [],
    });
    const request = received[0]!;
    expect(request.authorization).toBe("Bearer token-1");
    expect(request.body.variables).toEqual({
      after: "0x000000000000006400000000",
      maxBlock: "119",
      first: 50,
    });
    expect(request.body.query).toContain("where: { id_gt: $after, blockNumber_lte: $maxBlock }");
    expect(request.body.query).toContain("giveaway { id }");
  });

  it("reports rate limiting with the requested delay", async () => {
    reply = { status: 429, body: {}, headers: { "retry-after": "7" } };
    const error = await new HttpSubgraphClient(endpoint).meta().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SubgraphError);
    expect(error).toMatchObject({ retryAfterSeconds: 7 });
  });

  it("surfaces GraphQL errors", async () => {
    reply.body = { errors: [{ message: "Type `Query` has no field `fairDropsEvents`" }] };
    await expect(new HttpSubgraphClient(endpoint).meta()).rejects.toThrow(
      "Subgraph query failed: Type `Query` has no field `fairDropsEvents`",
    );
  });
});
