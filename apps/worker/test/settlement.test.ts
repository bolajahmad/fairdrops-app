import { Rng, quiz } from "@fairdrops/game-kit";
import { PayoutTree, verifyPayoutProof } from "@fairdrops/settlement";
import type { Address, Hex } from "@fairdrops/shared";
import { keccak256 } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Keyring } from "../src/chain/keyring.js";
import { applyEvent } from "../src/indexer/projector.js";
import { ClaimRelayer } from "../src/settlement/claim-relayer.js";
import { GiveawayUnwinder } from "../src/settlement/giveaway-unwinder.js";
import { SettlementBuilder } from "../src/settlement/settlement-builder.js";
import { SettlementReconciler } from "../src/settlement/settlement-reconciler.js";
import { SettlementSubmitter } from "../src/settlement/settlement-submitter.js";
import { SettlementVerifier } from "../src/settlement/settlement-verifier.js";
import { RelayProcessor } from "../src/settlement/relay-processor.js";
import { TxEngine } from "../src/chain/tx-engine.js";
import {
  BANK_HASH,
  CHAIN_ID,
  CONTRACT,
  bank,
  createHarness,
  owner,
  registerGames,
  runningSession,
  send,
  type Harness,
} from "./sessions-harness.js";

let h: Harness;
let builder: SettlementBuilder;
let verifier: SettlementVerifier;
let submitter: SettlementSubmitter;
let relayer: ClaimRelayer;
let unwinder: GiveawayUnwinder;
let reconciler: SettlementReconciler;
let keyring: Keyring;

const ALICE = "0x00000000000000000000000000000000000000a1" as Address;
const BOB = "0x00000000000000000000000000000000000000b2" as Address;
const CAROL = "0x00000000000000000000000000000000000000c3" as Address;
const roll = { type: "roll" };

beforeAll(async () => {
  h = await createHarness();
  builder = h.moduleRef.get(SettlementBuilder);
  verifier = h.moduleRef.get(SettlementVerifier);
  submitter = h.moduleRef.get(SettlementSubmitter);
  relayer = h.moduleRef.get(ClaimRelayer);
  unwinder = h.moduleRef.get(GiveawayUnwinder);
  reconciler = h.moduleRef.get(SettlementReconciler);
  keyring = h.moduleRef.get(Keyring);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  await registerGames(h.db);
  h.chain.operators.add(keyring.operator!.address.toLowerCase());
  for (const key of keyring.verifiers) h.chain.verifiers.add(key.address.toLowerCase());
});

/**
 * Plays dice to the end, as the runtime does, and mirrors the giveaway on the fake chain. Alice
 * and Bob roll; Carol joins but never plays, so she scores nothing.
 */
async function settledGame(rollers: Address[] = [ALICE, BOB]) {
  const session = await runningSession(
    h,
    { id: "dice", config: { windowSeconds: 30 } },
    [ALICE, BOB, CAROL],
    29_000,
  );
  for (const player of rollers) await send(h.redis, session.id, player, `${player}-1`, roll);
  await expect((await owner(h, session.id)).run()).resolves.toBe("settled");

  const giveaway = await h.db.giveaway.findUniqueOrThrow({
    where: { chainId_giveawayId: { chainId: CHAIN_ID, giveawayId: session.giveawayId } },
  });
  h.chain.addGiveaway(session.giveawayId as Hex, {
    host: "0x00000000000000000000000000000000000000f0",
    prize: 1000n,
    maxWinners: 3,
    metadataHash: keccak256(giveaway.metadataRaw),
    seedCommitment: session.seedCommitment as Hex,
    startTime: h.chain.now - 60,
    finalizeDeadline: Math.floor(giveaway.finalizeDeadline.getTime() / 1000),
  });
  return h.db.gameSession.findUniqueOrThrow({ where: { id: session.id } });
}

/** Feeds what the fake contract emitted through the real indexer projector. */
async function index(): Promise<void> {
  const events = h.chain.events.splice(0);
  await h.db.$transaction(async (tx) => {
    for (const event of events) {
      await applyEvent(tx, { chainId: CHAIN_ID, contractAddress: CONTRACT }, event);
    }
  });
}

async function signAll(sessionId: string): Promise<void> {
  for (const key of keyring.verifiers) await verifier.verify(sessionId, key);
}

const settlementOf = (sessionId: string) =>
  h.db.settlement.findUniqueOrThrow({
    where: { sessionId },
    include: { payouts: { orderBy: { rank: "asc" } }, signatures: true },
  });

describe("settlement", () => {
  it("pays a player who won places in several rounds once, with their shares added up", async () => {
    // Two 5 second quiz rounds with a 3 second break; one place per round, two places in all.
    const config = { bank: BANK_HASH, questions: 1, secondsPerQuestion: 5, revealSeconds: 0 };
    const session = await runningSession(h, { id: "quiz", config }, [ALICE, BOB], 500, {
      rounds: { winnersPerRound: 1, playSeconds: 60, cooldownSeconds: 3 },
    });
    const running = owner(h, session.id).then((o) => o.run());

    // The answer to each round's question, drawn as the rounds game draws it.
    const seed = h.vault.decrypt(session.seedCiphertext);
    const answerIn = (round: number) =>
      quiz.init({
        config: quiz.config.parse(config),
        players: [ALICE, BOB],
        startAt: session.startsAt.getTime() + round * 8_000,
        rng: Rng.fromSeed(seed).fork(`round/${round}`),
        resources: new Map([[BANK_HASH, bank]]),
      }).questions[0]!.answer;
    const answer = (round: number) => ({ type: "answer", question: 0, choice: answerIn(round) });

    await send(h.redis, session.id, ALICE, "a0", answer(0));
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    await send(h.redis, session.id, ALICE, "a1", answer(1));
    await expect(running).resolves.toBe("settled");

    const giveaway = await h.db.giveaway.findUniqueOrThrow({
      where: { chainId_giveawayId: { chainId: CHAIN_ID, giveawayId: session.giveawayId } },
    });
    h.chain.addGiveaway(session.giveawayId as Hex, {
      host: "0x00000000000000000000000000000000000000f0",
      prize: 1000n,
      maxWinners: 2,
      metadataHash: keccak256(giveaway.metadataRaw),
      seedCommitment: session.seedCommitment as Hex,
      startTime: h.chain.now - 60,
      finalizeDeadline: Math.floor(giveaway.finalizeDeadline.getTime() / 1000),
    });

    expect(await builder.build(session.id)).toBe("built");
    const settlement = await settlementOf(session.id);
    expect(settlement.winnerCount).toBe(1);
    expect(settlement.payouts.map((p) => [p.account, p.amount.toFixed()])).toEqual([
      [ALICE, "1000"],
    ]);
    // An independent verifier recomputes the same payouts from the transcript and signs.
    expect(await verifier.verify(session.id, keyring.verifiers[0]!)).toBe(true);
  }, 30_000);

  it("takes a finished game to claimed prizes", async () => {
    // Alice and Bob always both roll, so both score; Carol does not.
    const session = await settledGame();
    expect(session.status).toBe("SETTLING");

    // Build: v1 metadata splits 1000 equally between maxWinners (3) places; two qualify.
    expect(await builder.build(session.id)).toBe("built");
    let settlement = await settlementOf(session.id);
    expect(settlement).toMatchObject({ status: "PROPOSED", winnerCount: 2 });
    expect(settlement.totalPayout.toFixed()).toBe("666");
    expect(settlement.payouts.map((p) => p.amount.toFixed())).toEqual(["333", "333"]);
    expect(settlement.payouts.map((p) => p.account).sort()).toEqual([ALICE, BOB].sort());
    const tree = PayoutTree.load(settlement.tree as never);
    expect(tree.root).toBe(settlement.payoutRoot);
    for (const payout of settlement.payouts) {
      expect(
        verifyPayoutProof(
          settlement.payoutRoot as Hex,
          session.giveawayId as Hex,
          payout.account as Address,
          BigInt(payout.amount.toFixed()),
          payout.proof as Hex[],
        ),
      ).toBe(true);
    }

    // Verify: the first verifier's signature meets the threshold of 1.
    expect(await verifier.verify(session.id, keyring.verifiers[0]!)).toBe(true);
    settlement = await settlementOf(session.id);
    expect(settlement.status).toBe("SIGNED");

    // Submit: the fake contract checks the signature against VERIFIER_ROLE and the seed.
    expect(await submitter.submit(session.id)).toBe("mined");
    expect((await settlementOf(session.id)).status).toBe("SUBMITTED");
    expect((await h.db.gameSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe(
      "FINALIZING",
    );

    // Confirm from the indexed event, not the receipt.
    await index();
    await reconciler.confirm(new Date());
    settlement = await settlementOf(session.id);
    expect(settlement.status).toBe("CONFIRMED");
    expect((await h.db.gameSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe(
      "FINALIZED",
    );

    // Relay claims for both winners in one claimMany, then copy the indexed claims back.
    expect(await relayer.relay(session.id)).toBe(2);
    await index();
    expect(await reconciler.syncClaims()).toBe(2);
    settlement = await settlementOf(session.id);
    expect(settlement.payouts.every((p) => p.claimedAt && p.claimTx)).toBe(true);
    expect(h.chain.giveaways.get(session.giveawayId)!.claimed).toBe(666n);
    expect(h.chain.calls.map((c) => c.functionName)).toEqual(["finalize", "claimManyFor"]);
  });

  it("submits a signed claim the API queued, and follows it until it's mined", async () => {
    const session = await settledGame();
    expect(await builder.build(session.id)).toBe("built");
    await signAll(session.id);
    expect(await submitter.submit(session.id)).toBe("mined");
    await index();
    await reconciler.confirm(new Date());

    const payout = (await settlementOf(session.id)).payouts[0]!;
    const destination = "0x00000000000000000000000000000000000000d4" as Address;
    const relay = await h.db.relayRequest.create({
      data: {
        chainId: CHAIN_ID,
        action: "claim",
        account: payout.account,
        payload: {
          action: "claim",
          chainId: CHAIN_ID,
          giveawayId: session.giveawayId,
          account: payout.account,
          amount: payout.amount.toFixed(),
          recipient: destination,
          fee: "1",
          nonce: "0",
          deadline: Math.floor(Date.now() / 1000) + 600,
          signature: `0x${"11".repeat(65)}`,
          proof: payout.proof,
        },
        fee: "1",
        feeToken: "0x0000000000000000000000000000000000000000",
      },
    });

    const processor = h.moduleRef.get(RelayProcessor);
    await processor.tick();
    expect(await h.db.relayRequest.findUniqueOrThrow({ where: { id: relay.id } })).toMatchObject({
      status: "SENT",
    });
    await h.moduleRef.get(TxEngine).reconcile(new Date());
    await processor.tick();
    const done = await h.db.relayRequest.findUniqueOrThrow({ where: { id: relay.id } });
    expect(done.status).toBe("MINED");
    expect(done.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h.chain.calls.at(-1)?.functionName).toBe("claimWithSig");

    // Sending it again changes nothing: the request is settled.
    await processor.tick();
    expect(h.chain.calls.filter((c) => c.functionName === "claimWithSig")).toHaveLength(1);
  });

  it("marks a signed action that would revert as failed, in plain words", async () => {
    const session = await settledGame();
    expect(await builder.build(session.id)).toBe("built");
    await signAll(session.id);
    expect(await submitter.submit(session.id)).toBe("mined");
    await index();
    await reconciler.confirm(new Date());
    // Already collected, so the relayed claim reverts.
    expect(await relayer.relay(session.id)).toBe(2);

    const payout = (await settlementOf(session.id)).payouts[0]!;
    const relay = await h.db.relayRequest.create({
      data: {
        chainId: CHAIN_ID,
        action: "claim",
        account: payout.account,
        payload: {
          action: "claim",
          chainId: CHAIN_ID,
          giveawayId: session.giveawayId,
          account: payout.account,
          amount: payout.amount.toFixed(),
          recipient: payout.account,
          fee: "1",
          nonce: "0",
          deadline: Math.floor(Date.now() / 1000) + 600,
          signature: `0x${"11".repeat(65)}`,
          proof: payout.proof,
        },
        fee: "1",
        feeToken: "0x0000000000000000000000000000000000000000",
      },
    });
    await h.moduleRef.get(RelayProcessor).tick();
    expect(await h.db.relayRequest.findUniqueOrThrow({ where: { id: relay.id } })).toMatchObject({
      status: "FAILED",
      error: "This prize was already collected",
    });
  });

  it("needs signatures from as many verifiers as the contract's threshold", async () => {
    h.chain.threshold = 2;
    const session = await settledGame();
    await builder.build(session.id);

    await verifier.verify(session.id, keyring.verifiers[0]!);
    expect((await settlementOf(session.id)).status).toBe("PROPOSED");
    await verifier.verify(session.id, keyring.verifiers[1]!);
    expect((await settlementOf(session.id)).status).toBe("SIGNED");

    // The contract rejects unsorted or duplicate signers; the submitter sorts them.
    expect(await submitter.submit(session.id)).toBe("mined");
  });

  it("does not sign a proposal whose payouts differ from the host's policy", async () => {
    const session = await settledGame();
    await builder.build(session.id);
    // A compromised or buggy builder pays everything to one winner.
    const forged = PayoutTree.build(session.giveawayId as Hex, [
      { account: BOB, amount: 999n, rank: 1 },
    ]);
    await h.db.settlement.update({
      where: { sessionId: session.id },
      data: { payoutRoot: forged.root, totalPayout: "999", winnerCount: 1 },
    });

    await signAll(session.id);
    const settlement = await settlementOf(session.id);
    expect(settlement.signatures).toEqual([]);
    expect(settlement.status).toBe("PROPOSED");
  });

  it("does not sign with a key that lost VERIFIER_ROLE", async () => {
    const session = await settledGame();
    await builder.build(session.id);
    h.chain.verifiers.clear();
    await signAll(session.id);
    expect((await settlementOf(session.id)).signatures).toEqual([]);
  });

  it("fails a game nobody scored in, and cancels its giveaway so the host is refunded", async () => {
    const session = await settledGame([]);
    expect(await builder.build(session.id)).toBe("failed");
    expect(await h.db.gameSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      status: "FAILED",
      failureReason: "Nobody scored enough to win a prize",
      ranking: expect.any(Array) as unknown,
    });

    expect(await unwinder.cancel(session.id)).toBe(true);
    expect(h.chain.giveaways.get(session.giveawayId)!.status).toBe("Cancelled");
    await index();
    const giveaway = await h.db.giveaway.findFirstOrThrow({
      where: { giveawayId: session.giveawayId },
    });
    expect(giveaway.status).toBe("CANCELLED");
    // Nothing is left to unwind.
    expect(await unwinder.cancel(session.id)).toBe(false);
  });

  it("abandons a settlement the contract says is too late", async () => {
    const session = await settledGame();
    await builder.build(session.id);
    await signAll(session.id);
    h.chain.giveaways.get(session.giveawayId)!.finalizeDeadline = h.chain.now - 1;

    expect(await submitter.submit(session.id)).toBe("abandoned");
    expect((await settlementOf(session.id)).status).toBe("ABANDONED");
    expect((await h.db.gameSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe(
      "FAILED",
    );
  });

  it("sends finalize again after a transaction that reverted", async () => {
    const session = await settledGame();
    await builder.build(session.id);
    await signAll(session.id);

    // The verifier loses its role between the simulation and the block: finalize reverts.
    h.chain.automine = false;
    const pending = submitter.submit(session.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    h.chain.verifiers.clear();
    await h.chain.mine();
    expect(await pending).toBe("reverted");
    expect((await settlementOf(session.id)).status).toBe("SIGNED");

    for (const key of keyring.verifiers) h.chain.verifiers.add(key.address.toLowerCase());
    h.chain.automine = true;
    expect(await submitter.submit(session.id)).toBe("mined");
    const finalizes = await h.db.chainTransaction.findMany({ where: { kind: "FINALIZE" } });
    expect(finalizes.map((t) => t.status).sort()).toEqual(["MINED", "REVERTED"]);
  });

  it("fails the session when the giveaway is finalized with a different result", async () => {
    const session = await settledGame();
    await builder.build(session.id);
    // Some other settlement lands on-chain first (a compromised verifier threshold).
    await h.db.giveaway.updateMany({
      where: { giveawayId: session.giveawayId },
      data: {
        status: "FINALIZED",
        payoutRoot: `0x${"9".repeat(64)}`,
        seed: session.seed,
        claimDeadline: new Date(Date.now() + 86_400_000),
      },
    });
    await reconciler.confirm(new Date());
    expect((await settlementOf(session.id)).status).toBe("ABANDONED");
    expect((await h.db.gameSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe(
      "FAILED",
    );
  });

  it("gives up once the finalize deadline has passed without a result", async () => {
    const session = await settledGame();
    await builder.build(session.id);
    const giveaway = await h.db.giveaway.findFirstOrThrow({
      where: { giveawayId: session.giveawayId },
    });
    await reconciler.confirm(new Date(giveaway.finalizeDeadline.getTime() + 1_000));
    expect((await settlementOf(session.id)).failureReason).toMatch(/not finalized before/);
  });

  it("relays around a claim that cannot succeed", async () => {
    const session = await settledGame();
    await builder.build(session.id);
    await signAll(session.id);
    await submitter.submit(session.id);
    await index();
    await reconciler.confirm(new Date());

    // Bob's stored proof is wrong, so a batch containing it reverts; Alice is still paid.
    await h.db.settlementPayout.update({
      where: { sessionId_account: { sessionId: session.id, account: BOB } },
      data: { proof: [`0x${"1".repeat(64)}`] },
    });
    expect(await relayer.relay(session.id)).toBe(1);
    expect([...h.chain.giveaways.get(session.giveawayId)!.claimedBy]).toEqual([ALICE]);
    // Claims already made on-chain are skipped, even before the indexer catches up.
    expect(await relayer.relay(session.id)).toBe(0);
  });

  it("schedules each step from the state it finds", async () => {
    const session = await settledGame();
    await reconciler.scheduleSteps(new Date());
    const jobs = await h.redis.keys("bull:fd-settlement:build-*");
    expect(jobs.some((key) => key.includes(session.id))).toBe(true);
  });
});
