/**
 * End-to-end scenarios against a running FairDrops deployment (API and worker) on a testnet,
 * driven only through @fairdrops/sdk, the way any third party would. See docs/settlement.md,
 * "End to end on testnet".
 *
 *   pnpm --filter @fairdrops/e2e testnet
 *
 * Environment:
 *   E2E_API_URL            API of the deployment under test (its worker must index the chain)
 *   E2E_HOST_PRIVATE_KEY   Funded key that hosts the giveaways (prize + gas)
 *   E2E_CHAIN_ID           Default 84532 (Base Sepolia)
 *   E2E_ORIGIN             An origin the API accepts sign-ins from. Default http://localhost:3000
 *   E2E_SCENARIOS          Comma-separated: play, no-players, external. Default "play,no-players"
 *   E2E_PLAYERS            Players in the play scenario. Default 3
 *   E2E_PRIZE_WEI          Default 1000000000000000 (0.001 of the native currency)
 *   E2E_CLAIMS             "relayed" (default: the worker claims) or "self" (winners claim; the
 *                          worker must run with CLAIM_RELAY_ENABLED=false)
 *   E2E_LEAD_SECONDS       How far ahead games start. Default 240
 *   E2E_TIMEOUT_MINUTES    Per scenario. Default 25
 *   E2E_RPC_URL            Optional RPC for the chain; defaults to the registry's public one
 *   External scenario: E2E_EXTERNAL_GAME (id@version), E2E_REPORTER_PRIVATE_KEY, E2E_API_KEY
 */
import { setTimeout as sleep } from "node:timers/promises";
import { fairDropsAbi } from "@fairdrops/contracts";
import { FairDrops, fairDropsChain, publicClientFor } from "@fairdrops/sdk";
import { claimPrize } from "@fairdrops/sdk/claims";
import { createGiveaway, prepareGiveaway, withdraw, withdrawable } from "@fairdrops/sdk/host";
import { LiveConnection } from "@fairdrops/sdk/live";
import { ScoreReporter } from "@fairdrops/sdk/server";
import { verifyGiveaway } from "@fairdrops/sdk/verify";
import {
  NATIVE_TOKEN_ADDRESS,
  explorerAddressUrl,
  findChain,
  type Address,
  type GiveawayMetadataInput,
  type Hex,
  type SessionView,
} from "@fairdrops/shared";
import { createWalletClient, formatEther, http, parseEther, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ScenarioFailure, check, env, log, waitFor } from "./support.ts";

const apiUrl = env("E2E_API_URL");
const chainId = Number(env("E2E_CHAIN_ID", "84532"));
const origin = env("E2E_ORIGIN", "http://localhost:3000");
const scenarios = env("E2E_SCENARIOS", "play,no-players")
  .split(",")
  .map((s) => s.trim());
const playerCount = Number(env("E2E_PLAYERS", "3"));
const prize = BigInt(env("E2E_PRIZE_WEI", parseEther("0.001").toString()));
const claimMode = env("E2E_CLAIMS", "relayed");
const leadSeconds = Number(env("E2E_LEAD_SECONDS", "240"));
const timeoutMs = Number(env("E2E_TIMEOUT_MINUTES", "25")) * 60_000;
const rpcUrl = process.env.E2E_RPC_URL || undefined;

const chain = findChain(chainId);
if (!chain) throw new ScenarioFailure(`Chain ${chainId} is not in the registry`);
const publicClient: PublicClient = publicClientFor(chainId, rpcUrl);
const host = privateKeyToAccount(env("E2E_HOST_PRIVATE_KEY") as Hex);
const hostWallet = createWalletClient({
  account: host,
  chain: fairDropsChain(chainId),
  transport: http(rpcUrl),
});
const symbol = chain.nativeCurrency.symbol;

function newFairDrops(): FairDrops {
  return new FairDrops({ apiUrl, origin });
}

/** Hosts a native-currency giveaway starting `leadSeconds` from now, and waits for its session. */
async function hostGiveaway(
  metadata: GiveawayMetadataInput,
  maxWinners: number,
): Promise<{ giveawayId: Hex; session: SessionView }> {
  const fd = newFairDrops();
  const start = new Date(Date.now() + leadSeconds * 1000);
  const prepared = prepareGiveaway({
    chainId,
    token: NATIVE_TOKEN_ADDRESS,
    amount: prize,
    startTime: start,
    // The game is short; the rest leaves the worker's settlement margin before the deadline.
    finalizeDeadline: new Date(start.getTime() + 30 * 60_000),
    maxWinners,
    metadata,
  });
  const { giveawayId, transactionHash } = await createGiveaway(hostWallet, prepared, {
    publicClient,
  });
  log(`Created giveaway ${giveawayId} (tx ${transactionHash}), starts ${start.toISOString()}`);

  const session = await waitFor(
    "the indexer and planner to pick up the giveaway",
    async () => {
      const found = await fd.sessions.byGiveaway(chainId, giveawayId);
      if (found.status === "FAILED") {
        throw new ScenarioFailure(`Session failed at planning: ${found.failureReason}`);
      }
      return found;
    },
    Math.min(timeoutMs, leadSeconds * 1000),
  );
  log(`Session ${session.id} planned (${session.status})`);
  return { giveawayId, session };
}

async function balance(address: Address): Promise<bigint> {
  return publicClient.getBalance({ address });
}

// Scenarios

/** Players join, play dice live, the result is finalized, verified and every winner is paid. */
async function play(): Promise<void> {
  const game = await newFairDrops().games.get("dice", "1.0.0");
  check(game.status === "APPROVED", "dice@1.0.0 must be an approved game on this deployment");

  const { giveawayId, session } = await hostGiveaway(
    {
      v: 2,
      title: "E2E dice",
      description: "Automated end-to-end run",
      game: { id: "dice", version: "1.0.0", config: { rolls: 3, windowSeconds: 30 } },
      rewards: { kind: "weighted", bps: [6000, 3000, 1000] },
    },
    3,
  );

  const players = Array.from({ length: playerCount }, () => {
    const account = privateKeyToAccount(generatePrivateKey());
    return { account, fd: newFairDrops() };
  });
  for (const player of players) {
    await player.fd.auth.signIn(player.account, { chainId });
    await player.fd.sessions.join(session.id);
  }
  log(`${players.length} players signed in and joined`);

  const connections = await Promise.all(players.map((player) => LiveConnection.connect(player.fd)));
  try {
    const rooms = connections.map((live) => live.subscribe(session.id));
    await waitFor(
      "the game to start",
      async () => {
        const current = await players[0]!.fd.sessions.get(session.id);
        return current.status === "RUNNING" ? current : undefined;
      },
      leadSeconds * 1000 + 120_000,
      1_000,
    );
    log("Game running; rolling");
    let accepted = 0;
    await Promise.all(
      rooms.map(async (room) => {
        for (let roll = 0; roll < 3; roll++) {
          const result = await room.act({ type: "roll" });
          if (result.accepted) accepted += 1;
          await sleep(300);
        }
      }),
    );
    log(`${accepted} rolls accepted`);
  } finally {
    for (const live of connections) live.close();
  }

  const fd = players[0]!.fd;
  const before = new Map<Address, bigint>();
  for (const player of players) {
    const address = player.account.address.toLowerCase() as Address;
    before.set(address, await balance(address));
  }

  const finalized = await waitFor(
    "the result to be finalized on-chain",
    async () => {
      const current = await fd.sessions.get(session.id);
      if (current.status === "FAILED" || current.status === "CANCELLED") {
        throw new ScenarioFailure(`Session ended ${current.status}: ${current.failureReason}`);
      }
      return current.status === "FINALIZED" ? current : undefined;
    },
    timeoutMs,
  );
  const settlement = await fd.settlement.get(session.id);
  log(
    `Finalized: ${settlement.winnerCount} winners, ${formatEther(BigInt(settlement.totalPayout))} ${symbol}` +
      (settlement.finalizeTx ? `, tx ${settlement.finalizeTx}` : ""),
  );
  check(finalized.ranking && finalized.ranking.length === players.length, "Every player is ranked");

  const verification = await verifyGiveaway(fd, chainId, giveawayId, { publicClient });
  for (const c of verification.checks)
    log(`  verify ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
  check(verification.ok && verification.against === "onchain", "The result verifies independently");

  for (const payout of settlement.payouts) {
    const claim = await fd.claims.get(chainId, giveawayId, payout.account);
    if (claimMode === "self") {
      const player = players.find((p) => p.account.address.toLowerCase() === payout.account)!;
      const gas = parseEther("0.0002");
      await hostWallet.sendTransaction({
        account: host,
        chain: hostWallet.chain,
        to: payout.account,
        value: gas,
      });
      const wallet = createWalletClient({
        account: player.account,
        chain: fairDropsChain(chainId),
        transport: http(rpcUrl),
      });
      await claimPrize(wallet, claim, { publicClient });
      log(`  ${payout.account} claimed ${formatEther(BigInt(payout.amount))} ${symbol} itself`);
    }
    await waitFor(
      `${payout.account}'s prize`,
      async () =>
        (await fd.claims.get(chainId, giveawayId, payout.account)).claimedAt ? true : undefined,
      timeoutMs,
    );
    const gained = (await balance(payout.account)) - before.get(payout.account)!;
    if (claimMode === "relayed") {
      check(
        gained === BigInt(payout.amount),
        `${payout.account} received ${gained}, expected ${payout.amount}`,
      );
    }
    log(
      `  rank ${payout.rank}: ${payout.account} paid ${formatEther(BigInt(payout.amount))} ${symbol}`,
    );
  }

  // A second claim for the same winner must be refused by the contract.
  const first = settlement.payouts[0]!;
  const claim = await fd.claims.get(chainId, giveawayId, first.account);
  const repeat = await publicClient
    .simulateContract({
      account: host,
      address: claim.contract,
      abi: fairDropsAbi,
      functionName: "claim",
      args: [claim.giveawayId, claim.account, BigInt(claim.amount), claim.proof],
    })
    .then(() => "accepted")
    .catch((error: Error) => error.message);
  check(repeat !== "accepted" && /AlreadyClaimed/.test(repeat), "A second claim is refused");

  const remainder = await withdrawable(chainId, giveawayId, { publicClient });
  if (remainder > 0n) {
    await withdraw(hostWallet, chainId, giveawayId, { publicClient });
    log(`Host withdrew the undistributed ${formatEther(remainder)} ${symbol}`);
  }
}

/** Nobody joins: the game is cancelled, the operator unwinds it, the host is fully refunded. */
async function noPlayers(): Promise<void> {
  const { giveawayId, session } = await hostGiveaway(
    {
      v: 2,
      title: "E2E empty",
      description: "Nobody joins this one",
      game: { id: "dice", version: "1.0.0", config: { windowSeconds: 30 } },
      rewards: { kind: "equal", winners: 1 },
    },
    1,
  );
  const fd = newFairDrops();
  const ended = await waitFor(
    "the session to be cancelled",
    async () => {
      const current = await fd.sessions.get(session.id);
      return current.status === "CANCELLED" || current.status === "FAILED" ? current : undefined;
    },
    leadSeconds * 1000 + 180_000,
  );
  log(`Session ${ended.status}: ${ended.failureReason}`);

  await waitFor(
    "the operator to cancel the giveaway on-chain",
    async () =>
      (await fd.giveaways.get(chainId, giveawayId)).status === "CANCELLED" ? true : undefined,
    timeoutMs,
  );
  const refund = await withdrawable(chainId, giveawayId, { publicClient });
  check(refund === prize, `The host is owed the whole deposit (${refund} of ${prize})`);
  await withdraw(hostWallet, chainId, giveawayId, { publicClient });
  check((await withdrawable(chainId, giveawayId, { publicClient })) === 0n, "Nothing is left owed");
  log(`Host withdrew the full ${formatEther(refund)} ${symbol}, fee included`);
}

/** A third-party game server reports the standings; FairDrops settles them like any other. */
async function external(): Promise<void> {
  const [id, version] = env("E2E_EXTERNAL_GAME").split("@") as [string, string];
  const reporter = new ScoreReporter({
    apiUrl,
    apiKey: env("E2E_API_KEY"),
    reporter: privateKeyToAccount(env("E2E_REPORTER_PRIVATE_KEY") as Hex),
  });
  const { giveawayId, session } = await hostGiveaway(
    {
      v: 2,
      title: "E2E external",
      description: "Scored by an external server",
      game: { id, version, config: {} },
      rewards: { kind: "equal", winners: 2 },
    },
    2,
  );
  const players = Array.from({ length: 2 }, () => privateKeyToAccount(generatePrivateKey()));
  for (const account of players) {
    const fd = newFairDrops();
    await fd.auth.signIn(account, { chainId });
    await fd.sessions.join(session.id);
  }
  await waitFor(
    "the game to start",
    async () => ((await reporter.session(session.id)).status === "RUNNING" ? true : undefined),
    leadSeconds * 1000 + 120_000,
  );
  await reporter.report(
    session.id,
    players.map((account, i) => ({ player: account.address, score: 100 - i })),
  );
  log("Reported standings");
  const fd = newFairDrops();
  await waitFor(
    "the result to be finalized",
    async () => ((await fd.sessions.get(session.id)).status === "FINALIZED" ? true : undefined),
    timeoutMs,
  );
  const verification = await verifyGiveaway(fd, chainId, giveawayId, { publicClient });
  check(verification.ok, "The external result verifies against the reporter key");
  log("Finalized and verified");
}

const registry: Record<string, () => Promise<void>> = {
  play,
  "no-players": noPlayers,
  external,
};

async function main(): Promise<void> {
  const hostBalance = await balance(host.address);
  log(
    `Chain ${chain!.name} (${chainId}), API ${apiUrl}, host ${host.address} with ` +
      `${formatEther(hostBalance)} ${symbol} (${explorerAddressUrl(chain!, host.address) ?? "no explorer"})`,
  );
  check(hostBalance > prize * 3n, `The host needs more than ${formatEther(prize * 3n)} ${symbol}`);

  const results: { scenario: string; ok: boolean; seconds: number; error?: string }[] = [];
  for (const name of scenarios) {
    const run = registry[name];
    if (!run) throw new ScenarioFailure(`Unknown scenario ${name}`);
    log(`== ${name}`);
    const began = Date.now();
    try {
      await run();
      results.push({ scenario: name, ok: true, seconds: (Date.now() - began) / 1000 });
      log(`== ${name}: passed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        scenario: name,
        ok: false,
        seconds: (Date.now() - began) / 1000,
        error: message,
      });
      log(`== ${name}: FAILED: ${message}`);
    }
  }
  console.log(JSON.stringify({ chainId, apiUrl, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exit(1);
}

await main();
