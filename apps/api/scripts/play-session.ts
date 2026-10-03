/**
 * Plays one game end to end against a running API and worker, the way real players would:
 * signing in with SIWE, joining over REST, and playing over the WebSocket gateway. It then
 * checks the result the way anyone could, by replaying the published transcript.
 *
 * It stands in for the chain: it inserts the giveaway the indexer would have copied, and a
 * session whose seed is already committed, so no testnet, subgraph or operator key is needed.
 * See "Playing a game locally" in docs/game-runtime.md for how to run it and what it covers.
 *
 *   node scripts/play-session.ts [options]
 *
 *   --api <url,url>      API base URLs; players are spread across them (default http://127.0.0.1:3001)
 *   --game dice|quiz     Which game (default dice)
 *   --players <n>        Players who join (default 2)
 *   --outsider           Also connect a signed-in wallet that did not join, and let it try to act
 *   --accuracy <0..1>    Quiz: chance each answer is correct (default 0.7)
 *   --rolls <n>          Dice: rolls per player (default 3)
 *   --window <seconds>   Dice: rolling window, 30 to 900 (default 30)
 *   --questions <n>      Quiz: questions (default 3)
 *   --start-in <seconds> Delay between joining and the start (default 3)
 *
 * Environment: DATABASE_URL and SESSION_SEED_KEY must be the ones the worker uses.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createPrismaClient, type Prisma } from "@fairdrops/db";
import {
  Rng,
  dice,
  hashJson,
  hostedTranscriptSchema,
  quiz,
  quizBankSchema,
  transcriptHash,
  verifyTranscript,
  type QuizPublicView,
} from "@fairdrops/game-kit";
import {
  SIGN_IN_STATEMENT,
  canonicalJson,
  serverMessageSchema,
  sessionViewSchema,
  type ServerMessage,
} from "@fairdrops/shared";
import { encodeAbiParameters, keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { WebSocket } from "ws";

const CHAIN_ID = 84532;
const CONTRACT = "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72";
const APP_ORIGIN = "http://localhost:3000";

const { values: args } = parseArgs({
  options: {
    api: { type: "string", default: "http://127.0.0.1:3001" },
    game: { type: "string", default: "dice" },
    players: { type: "string", default: "2" },
    outsider: { type: "boolean", default: false },
    accuracy: { type: "string", default: "0.7" },
    rolls: { type: "string", default: "3" },
    window: { type: "string", default: "30" },
    questions: { type: "string", default: "3" },
    "start-in": { type: "string", default: "3" },
  },
});

const apis = args.api.split(",").map((url) => url.replace(/\/$/, ""));
const playerCount = Number(args.players);
const game = args.game === "quiz" ? quiz : dice;
if (!["dice", "quiz"].includes(args.game)) fail(`Unknown game ${args.game}`);
if (!process.env.DATABASE_URL) fail("Set DATABASE_URL to the worker's database");
if (!process.env.SESSION_SEED_KEY) fail("Set SESSION_SEED_KEY to the worker's key");

const db = createPrismaClient({ connectionString: process.env.DATABASE_URL });
const seedKey = Buffer.from(process.env.SESSION_SEED_KEY.replace(/^0x/, ""), "hex");

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString().slice(11, 23)}  ${message}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function post<T>(api: string, path: string, body: object, bearer?: string): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: bearer } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

async function get<T>(api: string, path: string): Promise<T> {
  const response = await fetch(`${api}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

interface Player {
  name: string;
  api: string;
  wallet: string;
  bearer: string;
  ws?: WebSocket;
  messages: ServerMessage[];
}

async function signIn(name: string, api: string): Promise<Player> {
  const account = privateKeyToAccount(generatePrivateKey());
  const { nonce } = await post<{ nonce: string }>(api, "/auth/nonce", { address: account.address });
  const origin = new URL(APP_ORIGIN);
  const message = createSiweMessage({
    address: account.address,
    chainId: CHAIN_ID,
    domain: origin.host,
    uri: origin.origin,
    nonce,
    version: "1",
    statement: SIGN_IN_STATEMENT,
    issuedAt: new Date(),
  });
  const session = await post<{ accessToken: string }>(api, "/auth/verify", {
    message,
    signature: await account.signMessage({ message }),
    transport: "body",
  });
  return {
    name,
    api,
    wallet: account.address.toLowerCase(),
    bearer: `Bearer ${session.accessToken}`,
    messages: [],
  };
}

async function connect(player: Player, sessionId: string): Promise<void> {
  const { ticket } = await post<{ ticket: string }>(
    player.api,
    "/auth/ws-ticket",
    {},
    player.bearer,
  );
  const ws = new WebSocket(`${player.api.replace(/^http/, "ws")}/ws?ticket=${ticket}`);
  ws.on("message", (data: Buffer) => {
    player.messages.push(serverMessageSchema.parse(JSON.parse(data.toString("utf8"))));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "subscribe", sessionId }));
  player.ws = ws;
}

function act(player: Player, sessionId: string, id: string, action: unknown): void {
  player.ws?.send(JSON.stringify({ type: "action", sessionId, id, action }));
}

async function waitFor(check: () => boolean, what: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const sawStatus = (player: Player, status: string) =>
  player.messages.some(
    (m) => (m.type === "status" || m.type === "snapshot") && m.status === status,
  );

// 1. What the indexer and the worker's planner would have produced from an on-chain giveaway.

const owner = await db.user.create({ data: {} });
let config: Record<string, unknown>;
const resources: { hash: Hex; content: unknown }[] = [];
if (game === quiz) {
  const bank = quizBankSchema.parse({
    v: 1,
    name: "Play script",
    questions: Array.from({ length: 20 }, (_, i) => ({
      prompt: `What is ${i} + ${i}?`,
      choices: [String(i * 2), String(i * 2 + 1), String(i * 2 + 2)],
      answer: 0,
    })),
  });
  const bankHash = hashJson(bank);
  await db.gameResource.upsert({
    where: { hash: bankHash },
    create: {
      hash: bankHash,
      kind: "quiz-bank",
      summary: "Play script: 20 questions",
      content: bank,
      createdById: owner.id,
    },
    update: {},
  });
  resources.push({ hash: bankHash, content: bank });
  config = quiz.config.parse({
    bank: bankHash,
    questions: Number(args.questions),
    secondsPerQuestion: 6,
    revealSeconds: 2,
  });
} else {
  config = dice.config.parse({ rolls: Number(args.rolls), windowSeconds: Number(args.window) });
}

const giveawayId = toHex(randomBytes(32));
const seed = toHex(randomBytes(32));
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", seedKey, iv);
const sealed = Buffer.concat([cipher.update(Buffer.from(seed.slice(2), "hex")), cipher.final()]);
const now = Date.now();
const startsAt = new Date(now + 10 * 60_000);
const duration = game.duration(config as never);
const metadata = {
  v: 1,
  title: "Play script",
  description: "",
  game: { id: game.id, version: game.version, config },
};
const metadataBytes = new TextEncoder().encode(canonicalJson(metadata));

await db.giveaway.create({
  data: {
    chainId: CHAIN_ID,
    giveawayId,
    contractAddress: CONTRACT,
    host: "0x000000000000000000000000000000000000dead",
    token: "0x0000000000000000000000000000000000000000",
    prize: "1000000000000000000",
    fee: "10000000000000000",
    startTime: startsAt,
    finalizeDeadline: new Date(now + 24 * 60 * 60_000),
    maxWinners: 3,
    claimWindowSeconds: 2_592_000,
    metadataHash: keccak256(metadataBytes),
    metadataRaw: metadataBytes,
    metadata: metadata as Prisma.InputJsonValue,
    createdBlock: 1n,
    createdTxHash: toHex(randomBytes(32)),
    createdAt: new Date(now),
    updatedBlock: 1n,
  },
});
const session = await db.gameSession.create({
  data: {
    chainId: CHAIN_ID,
    giveawayId,
    gameId: game.id,
    gameVersion: game.version,
    mode: "HOSTED",
    status: "SEED_COMMITTED",
    config: config as Prisma.InputJsonValue,
    seedCiphertext: new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), sealed])),
    seedCommitment: keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [giveawayId, seed]),
    ),
    seedCommitTx: toHex(randomBytes(32)),
    startsAt,
    endsAt: new Date(startsAt.getTime() + duration),
  },
});
log(`session ${session.id}: ${game.id}, ${canonicalJson(config)}`);

// 2. Players sign in and join through the API; an outsider only signs in.

const players: Player[] = [];
for (let i = 0; i < playerCount; i++) {
  const player = await signIn(`player${i + 1}`, apis[i % apis.length]!);
  await post(player.api, `/sessions/${session.id}/join`, {}, player.bearer);
  players.push(player);
}
log(`${players.length} players signed in and joined via ${apis.join(", ")}`);
const outsider = args.outsider ? await signIn("outsider", apis[0]!) : null;

// 3. Bring the start forward. The worker's planner starts the session on its next tick.

const start = new Date(Date.now() + Number(args["start-in"]) * 1000);
await db.gameSession.update({
  where: { id: session.id },
  data: { startsAt: start, endsAt: new Date(start.getTime() + duration) },
});
await db.giveaway.update({
  where: { chainId_giveawayId: { chainId: CHAIN_ID, giveawayId } },
  data: { startTime: start },
});
for (const player of [...players, ...(outsider ? [outsider] : [])])
  await connect(player, session.id);
log(`starts at ${start.toISOString()}, runs ${duration / 1000} s; waiting for the worker`);
await waitFor(() => players.every((p) => sawStatus(p, "RUNNING")), "the game to start", 30_000);
log("RUNNING: every socket was told the game started");

// 4. Play.

if (outsider) {
  act(
    outsider,
    session.id,
    "sneaky",
    game === quiz ? { type: "answer", question: 0, choice: 0 } : { type: "roll" },
  );
}

if (game === dice) {
  for (const player of players) {
    for (let r = 0; r < Number(args.rolls); r++) {
      setTimeout(
        () => act(player, session.id, `${player.name}-roll-${r}`, { type: "roll" }),
        Math.random() * 5_000,
      );
    }
  }
} else {
  // The script knows the seed, so it can work out the answers and miss some on purpose.
  const state = quiz.init({
    config: quiz.config.parse(config),
    players: players.map((p) => p.wallet as Hex),
    startAt: start.getTime(),
    rng: Rng.fromSeed(seed),
    resources: new Map(resources.map((r) => [r.hash, r.content])),
  });
  const accuracy = Number(args.accuracy);
  const answered = new Set<string>();
  const timer = setInterval(() => {
    for (const player of players) {
      const latest = [...player.messages]
        .reverse()
        .find((m) => m.type === "public" || m.type === "snapshot");
      const view = (
        latest?.type === "public"
          ? latest.view
          : latest?.type === "snapshot"
            ? latest.publicView
            : null
      ) as QuizPublicView | null;
      if (view?.phase !== "question" || answered.has(`${player.name}:${view.index}`)) continue;
      answered.add(`${player.name}:${view.index}`);
      const right = state.questions[view.index]!.answer;
      const choice = Math.random() < accuracy ? right : (right + 1) % view.choices.length;
      setTimeout(
        () =>
          act(player, session.id, `${player.name}-q${view.index}`, {
            type: "answer",
            question: view.index,
            choice,
          }),
        500 + Math.random() * 3_000,
      );
    }
  }, 200);
  setTimeout(() => clearInterval(timer), duration + 1_000);
}

await waitFor(
  () => players.every((p) => sawStatus(p, "SETTLING")),
  "the game to settle",
  duration + 30_000,
);

// 5. Report, and check the result the way anyone could.

for (const player of players) {
  const results = player.messages.flatMap((m) =>
    m.type === "player" && m.result ? [m.result] : [],
  );
  const accepted = results.filter((r) => r.accepted).length;
  const rejected = results.filter((r) => !r.accepted).map((r) => r.reason);
  log(
    `${player.name} ${player.wallet}: ${accepted} accepted${rejected.length ? `, rejected: ${rejected.join("; ")}` : ""}`,
  );
}
if (outsider) {
  const error = outsider.messages.find((m) => m.type === "error");
  log(
    `outsider: ${error?.type === "error" ? `${error.code} (${error.message})` : "no error received"}`,
  );
}

const view = sessionViewSchema.parse(await get(apis[0]!, `/sessions/${session.id}`));
const transcript = hostedTranscriptSchema.parse(
  await get(apis[0]!, `/sessions/${session.id}/transcript`),
);
const pushed = players[0]!.messages.find((m) => m.type === "status" && m.status === "SETTLING");
const names = new Map(players.map((p) => [p.wallet, p.name]));
log("standings:");
for (const standing of view.ranking ?? []) {
  log(
    `  ${standing.rank}. ${names.get(standing.player) ?? standing.player}  score ${standing.score}`,
  );
}
const checks = {
  "status is SETTLING": view.status === "SETTLING",
  "seed revealed matches the committed one": view.seed === seed,
  "transcript hash matches the session": transcriptHash(transcript) === view.transcriptHash,
  "replaying the transcript gives the same standings": verifyTranscript(transcript).ok,
  "standings pushed over the socket match REST":
    canonicalJson(pushed?.type === "status" ? pushed.ranking : null) ===
    canonicalJson(view.ranking),
};
for (const [check, ok] of Object.entries(checks)) log(`${ok ? "PASS" : "FAIL"}  ${check}`);
log(
  `${transcript.actions.length} actions in the transcript; GET ${apis[0]}/sessions/${session.id}/transcript`,
);

for (const player of [...players, ...(outsider ? [outsider] : [])]) player.ws?.close();
await db.$disconnect();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
