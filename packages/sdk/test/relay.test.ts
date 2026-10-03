import { FAIRDROPS_ACCOUNT_ADDRESS } from "@fairdrops/contracts";
import { checkExecuteCalls, relaySigner } from "@fairdrops/settlement";
import {
  NATIVE_TOKEN_ADDRESS,
  type Address,
  type RelayQuote,
  type RelayRequest,
  type RelayView,
} from "@fairdrops/shared";
import { createWalletClient, http, keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import type { FairDrops } from "../src/client.js";
import { RelayFailed, collectPrize, sendFromWallet } from "../src/relay.js";

const CONTRACT = "0x5ca0a86a6110917a5bb1170b0a18fd880aa8de72" as Address;
const RELAYER = "0x215ba01637f2bbf91fcf5fb4df6d41bc64820d65" as Address;
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Address;
const DEST = "0x00000000000000000000000000000000000000d4" as Address;

function fakeClient(quote: Partial<RelayQuote>, outcome: "MINED" | "FAILED" = "MINED") {
  const submitted: RelayRequest[] = [];
  const view = (status: RelayView["status"]): RelayView => ({
    id: "r1",
    chainId: 84532,
    action: "claim",
    account: DEST,
    status,
    fee: quote.fee ?? "0",
    feeToken: USDC,
    txHash: `0x${"ab".repeat(32)}`,
    error: status === "FAILED" ? "This prize was already collected" : null,
    createdAt: "",
    updatedAt: "",
  });
  const fd = {
    relay: {
      quote: () =>
        Promise.resolve({
          chainId: 84532,
          action: "claim",
          token: USDC,
          fee: "1000",
          relayer: RELAYER,
          contract: CONTRACT,
          nonce: "0",
          deadline: 2_000_000_000,
          delegate: null,
          delegated: null,
          authorizationNonce: null,
          ...quote,
        }),
      submit: (request: RelayRequest) => {
        submitted.push(request);
        return Promise.resolve(view("QUEUED"));
      },
      wait: () => Promise.resolve(view(outcome)),
    },
  } as unknown as FairDrops;
  return { fd, submitted };
}

function wallet() {
  return createWalletClient({
    account: privateKeyToAccount(generatePrivateKey()),
    chain: baseSepolia,
    transport: http("http://127.0.0.1:1"),
  });
}

describe("collectPrize", () => {
  it("signs a ClaimTo the server recovers, with the quoted fee and the chosen wallet", async () => {
    const { fd, submitted } = fakeClient({ fee: "2500" });
    const w = wallet();
    await collectPrize(fd, w, {
      chainId: 84532,
      giveawayId: keccak256(toHex("g")),
      amount: 1_000_000n,
      token: USDC,
      recipient: DEST,
    });
    const [request] = submitted;
    expect(request).toMatchObject({ action: "claim", fee: "2500", recipient: DEST });
    expect(await relaySigner(request!, CONTRACT)).toBe(w.account.address.toLowerCase());
  });

  it("throws the plain reason when the relayer couldn't send it", async () => {
    const { fd } = fakeClient({}, "FAILED");
    await expect(
      collectPrize(fd, wallet(), {
        chainId: 84532,
        giveawayId: keccak256(toHex("g")),
        amount: 1_000_000n,
        token: USDC,
      }),
    ).rejects.toThrow(RelayFailed);
  });
});

describe("sendFromWallet", () => {
  it("builds a batch the server accepts, and asks for a delegation the first time", async () => {
    const { fd, submitted } = fakeClient({
      action: "execute",
      fee: "40",
      delegate: FAIRDROPS_ACCOUNT_ADDRESS,
      delegated: false,
      authorizationNonce: 3,
    });
    const w = wallet();
    const asked: number[] = [];
    await sendFromWallet(fd, w, {
      chainId: 84532,
      token: NATIVE_TOKEN_ADDRESS,
      to: DEST,
      amount: 10_000n,
      signAuthorization: async ({ contractAddress, chainId, nonce }) => {
        asked.push(nonce);
        const signed = await w.account.signAuthorization({ contractAddress, chainId, nonce });
        return {
          address: signed.address,
          chainId: signed.chainId,
          nonce: signed.nonce,
          r: signed.r,
          s: signed.s,
          yParity: signed.yParity!,
        };
      },
    });
    expect(asked).toEqual([3]);
    const request = submitted[0]!;
    if (request.action !== "execute") throw new Error("expected a batch");
    expect(request.authorization?.nonce).toBe(3);
    expect(
      checkExecuteCalls(request.calls, "send", { contract: CONTRACT, relayer: RELAYER }),
    ).toEqual({ token: NATIVE_TOKEN_ADDRESS, amount: 10_000n, fee: 40n });
    expect(await relaySigner(request, CONTRACT)).toBe(w.account.address.toLowerCase());
  });

  it("refuses to go on without a way to authorize a new wallet", async () => {
    const { fd } = fakeClient({
      action: "execute",
      delegate: FAIRDROPS_ACCOUNT_ADDRESS,
      delegated: false,
      authorizationNonce: 0,
    });
    await expect(
      sendFromWallet(fd, wallet(), { chainId: 84532, token: USDC, to: DEST, amount: 5n }),
    ).rejects.toThrow(/authorize/);
  });
});
