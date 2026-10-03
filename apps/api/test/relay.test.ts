import { FAIRDROPS_ACCOUNT_ADDRESS, fairDropsAbi } from "@fairdrops/contracts";
import { executeTypedData, relayTypedData } from "@fairdrops/settlement";
import {
  errorResponseSchema,
  relayQuoteSchema,
  relayViewSchema,
  type Address,
  type Hex,
} from "@fairdrops/shared";
import request from "supertest";
import { encodeFunctionData, erc20Abi } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, newAccount, signIn, type SignedIn, type TestApp } from "./harness.js";
import { CHAIN_ID } from "./session-fixtures.js";
import { CONTRACT, createSettledGiveaway } from "./settlement-fixtures.js";

let t: TestApp;
const RELAYER = "0x215ba01637f2bbf91fcf5fb4df6d41bc64820d65" as Address;
const DEST = "0x00000000000000000000000000000000000000d4" as Address;
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Address;
const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

/** A signed-in winner of a confirmed giveaway, with their prize. */
async function winner() {
  const user = await signIn(t.server);
  const wallet = user.account.address.toLowerCase() as Address;
  const { giveawayId, computed } = await createSettledGiveaway(t.db, {
    players: [wallet, newAccount().address],
    status: "CONFIRMED",
  });
  const payout = computed.payouts.find((p) => p.account === wallet)!;
  return { user, wallet, giveawayId, amount: payout.amount };
}

async function quote(user: SignedIn, query: Record<string, string>) {
  const response = await request(t.server)
    .get("/relay/quote")
    .query({ chainId: String(CHAIN_ID), ...query })
    .set("authorization", user.bearer)
    .expect(200);
  return relayQuoteSchema.parse(response.body);
}

describe("gas-free collecting", () => {
  it("quotes, checks a signed claim and queues it with the proof filled in", async () => {
    const { user, wallet, giveawayId, amount } = await winner();
    const q = await quote(user, {
      action: "claim",
      account: wallet,
      token: "0x0000000000000000000000000000000000000000",
      amount: amount.toString(),
    });
    expect(q).toMatchObject({ relayer: RELAYER, contract: CONTRACT, nonce: "0" });
    expect(BigInt(q.fee)).toBeGreaterThan(0n);

    const message = {
      giveawayId,
      account: wallet,
      amount,
      recipient: DEST,
      fee: BigInt(q.fee),
      nonce: 0n,
      deadline: BigInt(q.deadline),
    };
    const signature = await user.account.signTypedData(
      relayTypedData(CHAIN_ID, CONTRACT, "ClaimTo", message),
    );
    const body = {
      action: "claim",
      chainId: CHAIN_ID,
      giveawayId,
      account: wallet,
      amount: amount.toString(),
      recipient: DEST,
      fee: q.fee,
      nonce: "0",
      deadline: q.deadline,
      signature,
    };
    const queued = relayViewSchema.parse(
      (
        await request(t.server)
          .post("/relay")
          .set("authorization", user.bearer)
          .send(body)
          .expect(202)
      ).body,
    );
    expect(queued).toMatchObject({ status: "QUEUED", action: "claim", account: wallet });
    const row = await t.db.relayRequest.findUniqueOrThrow({ where: { id: queued.id } });
    expect((row.payload as { proof: Hex[] }).proof.length).toBeGreaterThan(0);

    // A fee the winner didn't sign is refused: the recovered signer no longer matches.
    await request(t.server)
      .post("/relay")
      .set("authorization", user.bearer)
      .send({ ...body, fee: "1" })
      .expect(403);
  });

  it("refuses a stale nonce, a fee far below the quote, and a claim that would revert", async () => {
    const { user, wallet, giveawayId, amount } = await winner();
    const sign = async (fee: bigint, nonce: bigint) => {
      const deadline = Math.floor(Date.now() / 1000) + 600;
      const signature = await user.account.signTypedData(
        relayTypedData(CHAIN_ID, CONTRACT, "ClaimTo", {
          giveawayId,
          account: wallet,
          amount,
          recipient: DEST,
          fee,
          nonce,
          deadline: BigInt(deadline),
        }),
      );
      return {
        action: "claim",
        chainId: CHAIN_ID,
        giveawayId,
        account: wallet,
        amount: amount.toString(),
        recipient: DEST,
        fee: fee.toString(),
        nonce: nonce.toString(),
        deadline,
        signature,
      };
    };
    const fee = BigInt(
      (
        await quote(user, {
          action: "claim",
          account: wallet,
          token: "0x0000000000000000000000000000000000000000",
          amount: amount.toString(),
        })
      ).fee,
    );
    const post = (body: object) =>
      request(t.server).post("/relay").set("authorization", user.bearer).send(body);

    t.relayChain.nonces.set(wallet, 1n);
    expect(errorCode((await post(await sign(fee, 0n)).expect(409)).body)).toBe("CONFLICT");

    t.relayChain.nonces.clear();
    expect((await post(await sign(1n, 0n)).expect(409)).body).toMatchObject({
      error: { message: expect.stringContaining("fee is out of date") as string },
    });

    t.relayChain.revert = "AlreadyClaimed";
    expect((await post(await sign(fee, 0n)).expect(409)).body).toMatchObject({
      error: { message: expect.stringContaining("AlreadyClaimed") as string },
    });
  });

  it("only takes actions for the signed-in account", async () => {
    const { wallet, giveawayId, amount } = await winner();
    const someoneElse = await signIn(t.server);
    await request(t.server)
      .post("/relay")
      .set("authorization", someoneElse.bearer)
      .send({
        action: "claim",
        chainId: CHAIN_ID,
        giveawayId,
        account: wallet,
        amount: amount.toString(),
        recipient: DEST,
        fee: "1000",
        nonce: "0",
        deadline: Math.floor(Date.now() / 1000) + 600,
        signature: `0x${"11".repeat(65)}`,
      })
      .expect(403);
  });
});

describe("embedded wallet batches", () => {
  async function sendBatch(user: SignedIn, fee: bigint) {
    const wallet = user.account.address.toLowerCase() as Address;
    const calls = [
      {
        to: USDC,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [DEST, 50_000_000n],
        }),
      },
      {
        to: USDC,
        value: "0",
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [RELAYER, fee] }),
      },
    ];
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const signature = await user.account.signTypedData(
      executeTypedData(CHAIN_ID, wallet, {
        calls: calls.map((c) => ({ to: c.to, value: BigInt(c.value), data: c.data })),
        nonce: 0n,
        deadline: BigInt(deadline),
      }),
    );
    return {
      action: "execute",
      purpose: "send",
      chainId: CHAIN_ID,
      account: wallet,
      calls,
      nonce: "0",
      deadline,
      signature,
    };
  }

  it("needs a delegation the first time, then queues a send that pays the relayer", async () => {
    const user = await signIn(t.server);
    const wallet = user.account.address.toLowerCase() as Address;
    const q = await quote(user, {
      action: "execute",
      purpose: "send",
      account: wallet,
      token: USDC,
      amount: "50000000",
    });
    expect(q).toMatchObject({
      delegate: FAIRDROPS_ACCOUNT_ADDRESS,
      delegated: false,
      authorizationNonce: 0,
    });

    const body = await sendBatch(user, BigInt(q.fee));
    await request(t.server).post("/relay").set("authorization", user.bearer).send(body).expect(409);

    const authorization = await user.account.signAuthorization({
      chainId: CHAIN_ID,
      contractAddress: FAIRDROPS_ACCOUNT_ADDRESS,
      nonce: 0,
    });
    const queued = await request(t.server)
      .post("/relay")
      .set("authorization", user.bearer)
      .send({
        ...body,
        authorization: {
          address: authorization.address,
          chainId: authorization.chainId,
          nonce: authorization.nonce,
          r: authorization.r,
          s: authorization.s,
          yParity: authorization.yParity,
        },
      })
      .expect(202);
    expect(relayViewSchema.parse(queued.body)).toMatchObject({
      action: "execute",
      feeToken: USDC,
      fee: q.fee,
    });
  });

  it("refuses a batch that doesn't pay the relayer", async () => {
    const user = await signIn(t.server);
    const wallet = user.account.address.toLowerCase() as Address;
    t.relayChain.accounts.set(wallet, { delegated: true, nonce: 0n, transactionCount: 0 });
    const body = await sendBatch(user, 1000n);
    const unpaid = { ...body, calls: [body.calls[0]] };
    await request(t.server)
      .post("/relay")
      .set("authorization", user.bearer)
      .send(unpaid)
      .expect(403);
  });
});

describe("managing a giveaway from an embedded wallet", () => {
  async function cancelBatch(user: SignedIn, giveawayId: Hex, fee: bigint) {
    const wallet = user.account.address.toLowerCase() as Address;
    const calls = [
      {
        to: CONTRACT,
        value: "0",
        data: encodeFunctionData({ abi: fairDropsAbi, functionName: "cancel", args: [giveawayId] }),
      },
      { to: RELAYER, value: fee.toString(), data: "0x" as Hex },
    ];
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const signature = await user.account.signTypedData(
      executeTypedData(CHAIN_ID, wallet, {
        calls: calls.map((c) => ({ to: c.to, value: BigInt(c.value), data: c.data })),
        nonce: 0n,
        deadline: BigInt(deadline),
      }),
    );
    return {
      action: "execute",
      purpose: "manage",
      chainId: CHAIN_ID,
      account: wallet,
      calls,
      nonce: "0",
      deadline,
      signature,
    };
  }

  it("lets only the host cancel, with the fee weighed against the refund", async () => {
    const host = await signIn(t.server);
    const wallet = host.account.address.toLowerCase() as Address;
    const { giveawayId } = await createSettledGiveaway(t.db, {
      players: [newAccount().address],
      status: "CONFIRMED",
    });
    const giveaway = await t.db.giveaway.update({
      where: { chainId_giveawayId: { chainId: CHAIN_ID, giveawayId } },
      data: { host: wallet },
    });
    t.relayChain.accounts.set(wallet, { delegated: true, nonce: 0n, transactionCount: 0 });
    const q = await quote(host, {
      action: "execute",
      purpose: "manage",
      account: wallet,
      token: giveaway.token,
      amount: giveaway.prize.toFixed(),
    });
    await request(t.server)
      .post("/relay")
      .set("authorization", host.bearer)
      .send(await cancelBatch(host, giveawayId, BigInt(q.fee)))
      .expect(202);

    const stranger = await signIn(t.server);
    const strangerWallet = stranger.account.address.toLowerCase() as Address;
    t.relayChain.accounts.set(strangerWallet, { delegated: true, nonce: 0n, transactionCount: 0 });
    await request(t.server)
      .post("/relay")
      .set("authorization", stranger.bearer)
      .send(await cancelBatch(stranger, giveawayId, BigInt(q.fee)))
      .expect(403);
  });
});
