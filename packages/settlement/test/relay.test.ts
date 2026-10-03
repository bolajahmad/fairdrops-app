import { fairDropsAbi, fairDropsAccountAbi } from "@fairdrops/contracts";
import { NATIVE_TOKEN_ADDRESS, type Address, type RelayRequest } from "@fairdrops/shared";
import { decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { executeTypedData, relayTypedData } from "../src/relay.js";
import { RelayRejected, checkExecuteCalls, relayCall, relaySigner } from "../src/relay-calls.js";

const CONTRACT = "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72" as Address;
const RELAYER = "0x215ba01637f2bbf91fcf5fb4df6d41bc64820d65" as Address;
const TOKEN = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Address;
const DEST = "0x00000000000000000000000000000000000000d4" as Address;
const context = { contract: CONTRACT, relayer: RELAYER };

const transfer = (to: Address, amount: bigint) => ({
  to: TOKEN,
  value: "0",
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
});

describe("checkExecuteCalls", () => {
  it("accepts a send that ends by paying the relayer, and reports what it moves", () => {
    expect(
      checkExecuteCalls([transfer(DEST, 100n), transfer(RELAYER, 3n)], "send", context),
    ).toEqual({ token: TOKEN, amount: 100n, fee: 3n });
    expect(
      checkExecuteCalls(
        [
          { to: DEST, value: "100", data: "0x" },
          { to: RELAYER, value: "3", data: "0x" },
        ],
        "send",
        context,
      ),
    ).toEqual({ token: NATIVE_TOKEN_ADDRESS, amount: 100n, fee: 3n });
  });

  it("refuses a batch that doesn't pay the relayer, or does anything else", () => {
    expect(() => checkExecuteCalls([transfer(DEST, 100n)], "send", context)).toThrow(RelayRejected);
    const approveSomeone = {
      to: TOKEN,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [DEST, 10n ** 30n],
      }),
    };
    expect(() =>
      checkExecuteCalls([approveSomeone, transfer(RELAYER, 3n)], "send", context),
    ).toThrow(RelayRejected);
  });

  it("accepts hosting: approve FairDrops, create the giveaway, pay the fee in the prize token", () => {
    const params = {
      token: TOKEN,
      amount: 50n,
      startTime: 1n,
      finalizeDeadline: 2n,
      maxWinners: 3,
      metadata: "0x" as const,
    };
    const calls = [
      {
        to: TOKEN,
        value: "0",
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CONTRACT, 50n] }),
      },
      {
        to: CONTRACT,
        value: "0",
        data: encodeFunctionData({
          abi: fairDropsAbi,
          functionName: "createGiveaway",
          args: [params],
        }),
      },
      transfer(RELAYER, 2n),
    ];
    expect(checkExecuteCalls(calls, "host", context)).toEqual({
      token: TOKEN,
      amount: 50n,
      fee: 2n,
    });
    expect(() => checkExecuteCalls(calls.slice(1), "host", context)).toThrow(RelayRejected);
  });
});

describe("checkExecuteCalls for managing a giveaway", () => {
  const id = keccak256(toHex("giveaway"));
  const call = (functionName: "cancel" | "addFunds", value = "0") => ({
    to: CONTRACT,
    value,
    data:
      functionName === "cancel"
        ? encodeFunctionData({ abi: fairDropsAbi, functionName, args: [id] })
        : encodeFunctionData({ abi: fairDropsAbi, functionName, args: [id, 40n] }),
  });

  it("accepts a cancel paid from the refund, and adding funds after an approval", () => {
    expect(checkExecuteCalls([call("cancel"), transfer(RELAYER, 2n)], "manage", context)).toEqual({
      token: TOKEN,
      amount: 0n,
      fee: 2n,
      giveawayId: id,
    });
    const approve = {
      to: TOKEN,
      value: "0",
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CONTRACT, 40n] }),
    };
    expect(
      checkExecuteCalls([approve, call("addFunds"), transfer(RELAYER, 2n)], "manage", context),
    ).toEqual({ token: TOKEN, amount: 40n, fee: 2n, giveawayId: id });
    expect(
      checkExecuteCalls(
        [call("addFunds", "40"), { to: RELAYER, value: "2", data: "0x" }],
        "manage",
        context,
      ),
    ).toEqual({ token: NATIVE_TOKEN_ADDRESS, amount: 40n, fee: 2n, giveawayId: id });
  });

  it("refuses anything else on FairDrops", () => {
    const withdraw = {
      to: CONTRACT,
      value: "0",
      data: encodeFunctionData({ abi: fairDropsAbi, functionName: "withdraw", args: [id] }),
    };
    expect(() => checkExecuteCalls([withdraw, transfer(RELAYER, 2n)], "manage", context)).toThrow(
      RelayRejected,
    );
    expect(() =>
      checkExecuteCalls(
        [transfer(DEST, 5n), call("cancel"), transfer(RELAYER, 2n)],
        "manage",
        context,
      ),
    ).toThrow(RelayRejected);
  });
});

describe("relaySigner and relayCall", () => {
  it("recovers who signed a claim and builds claimWithSig with the proof", async () => {
    const winner = privateKeyToAccount(generatePrivateKey());
    const message = {
      giveawayId: keccak256(toHex("g")),
      account: winner.address.toLowerCase() as Address,
      amount: 100n,
      recipient: DEST,
      fee: 2n,
      nonce: 0n,
      deadline: 2_000_000_000n,
    };
    const signature = await winner.signTypedData(
      relayTypedData(84532, CONTRACT, "ClaimTo", message),
    );
    const request: RelayRequest = {
      action: "claim",
      chainId: 84532,
      giveawayId: message.giveawayId,
      account: message.account,
      amount: "100",
      recipient: DEST,
      fee: "2",
      nonce: "0",
      deadline: 2_000_000_000,
      signature,
    };
    expect(await relaySigner(request, CONTRACT)).toBe(message.account);

    const call = relayCall(request, { contract: CONTRACT, proof: [keccak256(toHex("p"))] });
    const decoded = decodeFunctionData({ abi: fairDropsAbi, data: call.data });
    expect(decoded.functionName).toBe("claimWithSig");
    expect(call.to).toBe(CONTRACT);
  });

  it("recovers an embedded wallet's batch and calls execute on the wallet itself", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const account = owner.address.toLowerCase() as Address;
    const calls = [transfer(DEST, 100n), transfer(RELAYER, 3n)];
    const signature = await owner.signTypedData(
      executeTypedData(84532, account, {
        calls: calls.map((c) => ({ to: c.to, value: BigInt(c.value), data: c.data })),
        nonce: 0n,
        deadline: 2_000_000_000n,
      }),
    );
    const request: RelayRequest = {
      action: "execute",
      purpose: "send",
      chainId: 84532,
      account,
      calls,
      nonce: "0",
      deadline: 2_000_000_000,
      signature,
    };
    expect(await relaySigner(request, CONTRACT)).toBe(account);
    const call = relayCall(request, { contract: CONTRACT });
    expect(call.to).toBe(account);
    expect(decodeFunctionData({ abi: fairDropsAccountAbi, data: call.data }).functionName).toBe(
      "execute",
    );
  });
});
