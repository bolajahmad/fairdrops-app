import type { Hex } from "@fairdrops/shared";
import { z } from "zod";
import { RAW_EVENT_FIELDS, rawEventSchema, type RawEvent } from "./events.js";

const REQUEST_TIMEOUT_MS = 15_000;

export interface SubgraphMeta {
  /** Latest block the subgraph has indexed, in the replica that answered. */
  block: bigint;
  deployment: string;
  hasIndexingErrors: boolean;
}

export interface EventBatch {
  /** The subgraph answered as of this block, so every event up to it is included. */
  meta: SubgraphMeta;
  /** Block hash of the event with id `after`, or null when the subgraph has no such event. */
  anchorBlockHash: Hex | null;
  events: RawEvent[];
}

export interface EventQuery {
  /** Return events with a larger id than this. */
  after: string;
  /** Ignore events above this block. */
  maxBlock: bigint;
  first: number;
}

/** Reads the FairDrops subgraph of one chain. */
export interface SubgraphClient {
  meta(): Promise<SubgraphMeta>;
  events(query: EventQuery): Promise<EventBatch>;
}

export class SubgraphError extends Error {
  constructor(
    message: string,
    /** Seconds the server asked us to wait, from a 429 response. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SubgraphError";
  }
}

const metaSchema = z
  .object({
    block: z.object({ number: z.number().int().nonnegative() }),
    deployment: z.string().min(1),
    hasIndexingErrors: z.boolean(),
  })
  .transform((meta): SubgraphMeta => ({
    block: BigInt(meta.block.number),
    deployment: meta.deployment,
    hasIndexingErrors: meta.hasIndexingErrors,
  }));

const META_QUERY = `query Meta { _meta { block { number } deployment hasIndexingErrors } }`;

// graph-node answers a whole query as of one block, so _meta here is the block the events
// reflect. The anchor re-reads the last copied event to detect a reorg beneath the cursor.
const EVENTS_QUERY = `query Events($after: Bytes!, $maxBlock: BigInt!, $first: Int!) {
  _meta { block { number } deployment hasIndexingErrors }
  anchor: fairDropsEvent(id: $after) { blockHash }
  events: fairDropsEvents(
    first: $first
    orderBy: id
    orderDirection: asc
    where: { id_gt: $after, blockNumber_lte: $maxBlock }
  ) {
    ${RAW_EVENT_FIELDS}
  }
}`;

const eventsResponseSchema = z.object({
  _meta: metaSchema,
  anchor: z.object({ blockHash: z.string().regex(/^0x[0-9a-f]{64}$/) }).nullable(),
  events: z.array(rawEventSchema),
});

const graphqlResponseSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

export class HttpSubgraphClient implements SubgraphClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiToken?: string,
  ) {}

  async meta(): Promise<SubgraphMeta> {
    const data = await this.request(META_QUERY, {});
    return z.object({ _meta: metaSchema }).parse(data)._meta;
  }

  async events({ after, maxBlock, first }: EventQuery): Promise<EventBatch> {
    const data = await this.request(EVENTS_QUERY, {
      after,
      maxBlock: maxBlock.toString(),
      first,
    });
    const parsed = eventsResponseSchema.parse(data);
    return {
      meta: parsed._meta,
      anchorBlockHash: (parsed.anchor?.blockHash as Hex | undefined) ?? null,
      events: parsed.events,
    };
  }

  private async request(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`;

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new SubgraphError(`Subgraph request failed: ${(error as Error).message}`);
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new SubgraphError(
        "Subgraph rate limit reached",
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    if (!response.ok) {
      throw new SubgraphError(`Subgraph responded ${response.status} ${response.statusText}`);
    }

    const body = graphqlResponseSchema.parse(await response.json());
    if (body.errors?.length) {
      throw new SubgraphError(
        `Subgraph query failed: ${body.errors.map((e) => e.message).join("; ")}`,
      );
    }
    return body.data;
  }
}
