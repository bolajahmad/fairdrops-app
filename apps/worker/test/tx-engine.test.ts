import { fairDropsAbi } from "@fairdrops/contracts";
import type { Address, Hex } from "@fairdrops/shared";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ContractRevert } from "../src/chain/rpc.js";
import { TxEngine, TxRefused, type TxIntent } from "../src/chain/tx-engine.js";
import { CHAIN_ID, CONTRACT, createHarness, type Harness } from "./sessions-harness.js";

let h: Harness;
let engine: TxEngine;
const operator = privateKeyToAccount(`0x${"a1".repeat(32)}`).address.toLowerCase() as Address;

beforeAll(async () => {
  h = await createHarness();
  engine = h.moduleRef.get(TxEngine);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  h.chain.operators.add(operator);
});

/** A cancel of a fresh giveaway: a call the fake contract accepts from the operator. */
function cancelIntent(label: string): TxIntent {
  const id = keccak256(toHex(label));
  h.chain.addGiveaway(id, { startTime: h.chain.now + 3600 });
  return {
    chainId: CHAIN_ID,
    kind: "CANCEL",
    ref: label,
    sender: "operator",
    to: CONTRACT,
    data: encodeFunctionData({ abi: fairDropsAbi, functionName: "cancel", args: [id] }),
  };
}

describe("TxEngine", () => {
  it("records, sends and follows a transaction to its receipt", async () => {
    const tx = await engine.send(cancelIntent("one"));
    expect(tx).toMatchObject({ status: "SENT", nonce: 0, sender: operator, kind: "CANCEL" });

    const settled = await engine.waitFor(tx.id);
    expect(settled).toMatchObject({ status: "MINED", minedHash: tx.hashes[0] });
    expect(h.chain.calls.map((c) => c.functionName)).toEqual(["cancel"]);
  });

  it("returns the transaction already sent for an intent instead of sending another", async () => {
    const intent = cancelIntent("once");
    const first = await engine.send(intent);
    const second = await engine.send(intent);
    expect(second.id).toBe(first.id);
    expect(h.chain.calls).toHaveLength(1);
  });

  it("gives concurrent sends from one key consecutive nonces", async () => {
    h.chain.automine = false;
    const sent = await Promise.all(
      Array.from({ length: 6 }, (_, i) => engine.send(cancelIntent(`batch-${i}`))),
    );
    expect(sent.map((tx) => tx.nonce).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    await h.chain.mine();
    for (const tx of sent) expect((await engine.waitFor(tx.id)).status).toBe("MINED");
  });

  it("refuses to send a call that would revert", async () => {
    const intent = cancelIntent("twice");
    await engine.waitFor((await engine.send(intent)).id);
    await expect(engine.send({ ...intent, ref: "twice-again" })).rejects.toBeInstanceOf(
      ContractRevert,
    );
  });

  it("keeps a transaction whose broadcast timed out, and rebroadcasts it unchanged", async () => {
    h.chain.sendFailure = "timeout";
    await expect(engine.send(cancelIntent("flaky"))).rejects.toThrow();
    const [row] = await h.db.chainTransaction.findMany();
    expect(row).toMatchObject({ status: "SIGNED", nonce: 0 });

    h.chain.sendFailure = null;
    await engine.reconcile(new Date(Date.now() + 20_000)); // rebroadcast
    await engine.reconcile(); // receipt
    const settled = await h.db.chainTransaction.findUniqueOrThrow({ where: { id: row!.id } });
    expect(settled).toMatchObject({ status: "MINED", hashes: row!.hashes });
  });

  it("frees the nonce of a transaction the node refused", async () => {
    h.chain.sendFailure = "refuse";
    await expect(engine.send(cancelIntent("broke"))).rejects.toBeInstanceOf(TxRefused);
    h.chain.sendFailure = null;
    const next = await engine.send(cancelIntent("funded"));
    expect(next.nonce).toBe(0);
    const statuses = await h.db.chainTransaction.findMany({ orderBy: { createdAt: "asc" } });
    expect(statuses.map((t) => t.status)).toEqual(["FAILED", "SENT"]);
  });

  it("resends a stuck transaction with higher fees at the same nonce", async () => {
    h.chain.automine = false;
    const tx = await engine.send(cancelIntent("stuck"));
    await engine.reconcile(new Date(Date.now() + 61_000));

    const bumped = await h.db.chainTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(bumped.hashes).toHaveLength(2);
    expect(bumped.nonce).toBe(tx.nonce);
    expect(BigInt(bumped.maxFeePerGas!.toFixed())).toBeGreaterThan(
      BigInt(tx.maxFeePerGas!.toFixed()),
    );

    await h.chain.mine();
    const settled = await engine.waitFor(tx.id);
    expect(settled).toMatchObject({ status: "MINED", minedHash: bumped.hashes[1] as Hex });
  });

  it("marks a transaction dropped when its nonce was used by another", async () => {
    h.chain.automine = false;
    const tx = await engine.send(cancelIntent("lost"));
    // Someone else sends from the same key with this nonce and it is mined.
    await h.db.chainTransaction.update({
      where: { id: tx.id },
      data: { hashes: [`0x${"9".repeat(64)}`] },
    });
    await h.chain.mine();
    await engine.reconcile(new Date(Date.now() + 61_000));
    const dropped = await h.db.chainTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(dropped.status).toBe("DROPPED");
  });
});
