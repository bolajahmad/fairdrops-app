import { fairDropsAbi } from "@fairdrops/contracts";
import {
  recoverSettlementSigner,
  seedCommitment,
  settlementDigest,
  verifyPayoutProof,
  type SettlementMessage,
} from "@fairdrops/settlement";
import type { Address, Hex } from "@fairdrops/shared";
import {
  decodeFunctionData,
  defineChain,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  TimeoutError,
  type Chain,
} from "viem";
import type { OnchainGiveaway, FairDropsReader } from "../src/chain/reader.js";
import {
  ContractRevert,
  type CallRequest,
  type ChainRpc,
  type FeeQuote,
  type Receipt,
} from "../src/chain/rpc.js";
import type { FairDropsEvent } from "../src/indexer/events.js";

const ZERO: Hex = `0x${"0".repeat(64)}`;
const CLAIM_WINDOW = 30 * 24 * 60 * 60;

interface FakeGiveaway extends OnchainGiveaway {
  winnerCount: number;
  claimed: bigint;
  claimedBy: Set<string>;
}

/**
 * An in-memory FairDrops contract behind the worker's chain ports. It enforces what settlement
 * depends on the way the contract does: verifier signatures over the EIP-712 digest (sorted,
 * from VERIFIER_ROLE holders, meeting the threshold), the seed commitment, the finalize deadline,
 * Merkle proofs and one claim per account. Transactions are real signed transactions: nonces
 * are checked and receipts appear when the fake "mines". Emitted events can be fed to the real
 * indexer projector.
 */
export class FakeChain implements ChainRpc, FairDropsReader {
  readonly chainId: number;
  readonly chain: Chain;
  contract: Address;
  block = 1_000n;
  /** Seconds; what `block.timestamp` would be. */
  now = Math.floor(Date.now() / 1000);
  threshold = 1;
  verifiers = new Set<string>();
  operators = new Set<string>();
  giveaways = new Map<string, FakeGiveaway>();
  /** Mine each transaction as soon as it is sent. When false, call mine(). */
  automine = true;
  autoblock = true;
  /** Make sendRawTransaction fail: a timeout (the node may have it) or an outright refusal. */
  sendFailure: "timeout" | "refuse" | null = null;
  events: FairDropsEvent[] = [];
  calls: { functionName: string; from: Address; hash: Hex }[] = [];

  private readonly latest = new Map<string, number>();
  private readonly mempool: { hash: Hex; raw: Hex; from: Address; nonce: number }[] = [];
  private readonly receipts = new Map<string, Receipt>();
  private logIndex = 0;

  constructor(chainId: number, contract: Address) {
    this.chainId = chainId;
    this.contract = contract.toLowerCase() as Address;
    this.chain = defineChain({
      id: chainId,
      name: "Fake",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["http://fake.invalid"] } },
    });
  }

  /** Forgets every giveaway, transaction and setting, as a fresh chain. */
  reset(): void {
    this.block = 1_000n;
    this.now = Math.floor(Date.now() / 1000);
    this.threshold = 1;
    this.verifiers.clear();
    this.operators.clear();
    this.giveaways.clear();
    this.automine = true;
    this.autoblock = true;
    this.sendFailure = null;
    this.events = [];
    this.calls = [];
    this.latest.clear();
    this.mempool.splice(0);
    this.receipts.clear();
    this.logIndex = 0;
  }

  addGiveaway(id: Hex, fields: Partial<FakeGiveaway> = {}): FakeGiveaway {
    const giveaway: FakeGiveaway = {
      status: "Active",
      host: "0x00000000000000000000000000000000000000a1",
      prize: 1000n,
      maxWinners: 3,
      startTime: this.now - 60,
      finalizeDeadline: this.now + 24 * 60 * 60,
      metadataHash: ZERO,
      seedCommitment: ZERO,
      payoutRoot: ZERO,
      transcriptHash: ZERO,
      totalPayout: 0n,
      claimDeadline: 0,
      winnerCount: 0,
      claimed: 0n,
      claimedBy: new Set(),
      ...fields,
    };
    this.giveaways.set(id.toLowerCase(), giveaway);
    return giveaway;
  }

  // ChainRpc

  pendingNonce(address: Address): Promise<number> {
    const pending = this.mempool.filter((tx) => tx.from === address.toLowerCase()).length;
    return Promise.resolve(this.nonceOf(address) + pending);
  }

  latestNonce(address: Address): Promise<number> {
    return Promise.resolve(this.nonceOf(address));
  }

  /** Each poll sees one more (empty) block, as time passes on a real chain. */
  blockNumber(): Promise<bigint> {
    if (this.autoblock) this.block += 1n;
    return Promise.resolve(this.block);
  }

  fees(): Promise<FeeQuote> {
    return Promise.resolve({
      type: "eip1559",
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });
  }

  async estimateGas(call: CallRequest): Promise<bigint> {
    await this.simulate(call);
    return 200_000n;
  }

  async simulate(call: CallRequest): Promise<void> {
    await this.execute(call.from, call.data, false);
  }

  async sendRawTransaction(raw: Hex): Promise<Hex> {
    if (this.sendFailure === "timeout") {
      throw new TimeoutError({ body: {}, url: "http://fake.invalid" });
    }
    if (this.sendFailure === "refuse")
      throw new Error("insufficient funds for gas * price + value");
    const hash = keccak256(raw);
    if (this.receipts.has(hash) || this.mempool.some((tx) => tx.hash === hash)) {
      throw new Error("already known");
    }
    const tx = parseTransaction(raw);
    const from = (
      await recoverTransactionAddress({ serializedTransaction: raw as never })
    ).toLowerCase() as Address;
    const expected = await this.pendingNonce(from);
    if (tx.nonce! < this.nonceOf(from)) throw new Error("nonce too low");
    if (tx.nonce! > expected) throw new Error(`nonce gap: expected ${expected}`);
    // A replacement with the same nonce takes the old one's place.
    const replaced = this.mempool.findIndex((p) => p.from === from && p.nonce === tx.nonce);
    if (replaced >= 0) this.mempool.splice(replaced, 1);
    this.mempool.push({ hash, raw, from, nonce: tx.nonce! });
    if (this.automine) await this.mine();
    return hash;
  }

  /** Includes every pending transaction in a new block, in nonce order. */
  async mine(): Promise<void> {
    this.block += 1n;
    this.now += 2;
    const pending = this.mempool.splice(0).sort((a, b) => a.nonce - b.nonce);
    for (const tx of pending) {
      const { data } = parseTransaction(tx.raw);
      let status: Receipt["status"] = "success";
      try {
        await this.execute(tx.from, data ?? "0x", true, tx.hash);
      } catch {
        status = "reverted";
      }
      this.latest.set(tx.from, tx.nonce + 1);
      this.receipts.set(tx.hash, { hash: tx.hash, status, blockNumber: this.block });
    }
  }

  receipt(hash: Hex): Promise<Receipt | null> {
    return Promise.resolve(this.receipts.get(hash) ?? null);
  }

  balance(): Promise<bigint> {
    return Promise.resolve(10n ** 18n);
  }

  read<T>(_contract: Address, functionName: string, args: readonly unknown[]): Promise<T> {
    throw new Error(`read(${functionName}, ${args.length} args) is not faked; use the reader`);
  }

  // FairDropsReader

  giveaway(_chainId: number, _contract: Address, id: Hex): Promise<OnchainGiveaway> {
    const g = this.giveaways.get(id.toLowerCase());
    if (!g) return Promise.resolve({ ...this.addGiveaway(id), status: "None" });
    return Promise.resolve({ ...g });
  }

  verifierThreshold(): Promise<number> {
    return Promise.resolve(this.threshold);
  }

  isVerifier(_chainId: number, _contract: Address, account: Address): Promise<boolean> {
    return Promise.resolve(this.verifiers.has(account.toLowerCase()));
  }

  settlementDigest(chainId: number, contract: Address, s: SettlementMessage): Promise<Hex> {
    return Promise.resolve(settlementDigest(chainId, contract, s));
  }

  isClaimed(_chainId: number, _contract: Address, id: Hex, account: Address): Promise<boolean> {
    return Promise.resolve(
      this.giveaways.get(id.toLowerCase())?.claimedBy.has(account.toLowerCase()) ?? false,
    );
  }

  // The contract

  private async execute(
    from: Address,
    data: Hex,
    commit: boolean,
    hash: Hex = ZERO,
  ): Promise<void> {
    const call = decodeFunctionData({ abi: fairDropsAbi, data });
    const sender = from.toLowerCase();
    const emit = (event: Record<string, unknown>) => {
      if (!commit) return;
      this.events.push({
        id: "0x",
        blockNumber: this.block,
        logIndex: this.logIndex++,
        blockHash: keccak256(`0x${this.block.toString(16).padStart(64, "0")}`),
        transactionHash: hash,
        timestamp: new Date(this.now * 1000),
        ...event,
      } as unknown as FairDropsEvent);
    };
    if (commit) this.calls.push({ functionName: call.functionName, from, hash });

    // The fake implements only the calls the worker sends; anything else throws below.
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
    switch (call.functionName) {
      case "commitSeed": {
        const [id, commitment] = call.args;
        if (!this.operators.has(sender))
          throw new ContractRevert("AccessControlUnauthorizedAccount");
        const g = this.active(id);
        if (this.now >= g.startTime) throw new ContractRevert("TooLate");
        if (g.seedCommitment !== ZERO) throw new ContractRevert("SeedAlreadyCommitted");
        if (commit) g.seedCommitment = commitment;
        emit({ kind: "SeedCommitted", giveawayId: id, commitment });
        return;
      }
      case "finalize": {
        const [id, s, signatures] = call.args;
        const g = this.active(id);
        if (this.now < g.startTime) throw new ContractRevert("TooEarly");
        if (this.now > g.finalizeDeadline) throw new ContractRevert("TooLate");
        if (g.seedCommitment === ZERO) throw new ContractRevert("SeedNotCommitted");
        if (seedCommitment(id, s.seed) !== g.seedCommitment)
          throw new ContractRevert("SeedMismatch");
        if (
          s.payoutRoot === ZERO ||
          s.totalPayout === 0n ||
          s.winnerCount === 0 ||
          s.winnerCount > g.maxWinners
        ) {
          throw new ContractRevert("InvalidSettlement");
        }
        if (s.totalPayout > g.prize) throw new ContractRevert("PayoutExceedsPrize");
        if (signatures.length < this.threshold) {
          throw new ContractRevert("InsufficientSignatures", [signatures.length, this.threshold]);
        }
        await this.checkSignatures({ giveawayId: id, ...s }, signatures);
        emit({
          kind: "GiveawayFinalized",
          giveawayId: id,
          payoutRoot: s.payoutRoot,
          totalPayout: s.totalPayout,
          winnerCount: s.winnerCount,
          seed: s.seed,
          transcriptHash: s.transcriptHash,
          claimDeadline: new Date((this.now + CLAIM_WINDOW) * 1000),
        });
        if (!commit) return;
        Object.assign(g, {
          status: "Finalized",
          payoutRoot: s.payoutRoot,
          totalPayout: s.totalPayout,
          winnerCount: s.winnerCount,
          transcriptHash: s.transcriptHash,
          claimDeadline: this.now + CLAIM_WINDOW,
        });
        return;
      }
      case "claimMany":
      case "claimManyFor": {
        const [requests] = call.args;
        if (call.functionName === "claimManyFor") {
          const [, fees] = call.args;
          requests.forEach((r, i) => {
            if (fees[i]! > (r.amount * 200n) / 10_000n) throw new ContractRevert("FeeTooHigh");
          });
        }
        const staged = new Map<string, Set<string>>();
        for (const r of requests) {
          const g = this.giveaways.get(r.id.toLowerCase());
          if (!g || g.status !== "Finalized")
            throw new ContractRevert("InvalidStatus", [g?.status]);
          if (this.now > g.claimDeadline) throw new ContractRevert("ClaimWindowClosed");
          const account = r.account.toLowerCase();
          const seen = staged.get(r.id) ?? new Set();
          if (g.claimedBy.has(account) || seen.has(account))
            throw new ContractRevert("AlreadyClaimed");
          if (!verifyPayoutProof(g.payoutRoot, r.id, r.account, r.amount, r.proof)) {
            throw new ContractRevert("InvalidProof");
          }
          seen.add(account);
          staged.set(r.id, seen);
        }
        for (const r of requests) {
          emit({
            kind: "Claimed",
            giveawayId: r.id,
            account: r.account.toLowerCase(),
            recipient: r.account.toLowerCase(),
            amount: r.amount,
          });
          if (!commit) continue;
          const g = this.giveaways.get(r.id.toLowerCase())!;
          g.claimedBy.add(r.account.toLowerCase());
          g.claimed += r.amount;
        }
        return;
      }
      case "claimWithSig": {
        // Signatures are checked by the real contract and the settlement package's tests.
        const [r, recipient, fee] = call.args;
        const g = this.giveaways.get(r.id.toLowerCase());
        if (!g || g.status !== "Finalized") throw new ContractRevert("InvalidStatus", [g?.status]);
        const account = r.account.toLowerCase();
        if (g.claimedBy.has(account)) throw new ContractRevert("AlreadyClaimed");
        if (!verifyPayoutProof(g.payoutRoot, r.id, r.account, r.amount, r.proof)) {
          throw new ContractRevert("InvalidProof");
        }
        if (fee >= r.amount) throw new ContractRevert("FeeTooHigh");
        emit({
          kind: "Claimed",
          giveawayId: r.id,
          account,
          recipient: recipient.toLowerCase(),
          amount: r.amount,
        });
        if (commit) {
          g.claimedBy.add(account);
          g.claimed += r.amount;
        }
        return;
      }
      case "cancel": {
        const [id] = call.args;
        const g = this.active(id);
        const isHost = sender === g.host;
        if (!(isHost && this.now < g.startTime) && !this.operators.has(sender)) {
          throw new ContractRevert(isHost ? "TooLate" : "NotHost");
        }
        emit({ kind: "GiveawayCancelled", giveawayId: id, by: sender });
        if (commit) g.status = "Cancelled";
        return;
      }
      default:
        throw new Error(`FakeChain does not implement ${call.functionName}`);
    }
  }

  private active(id: Hex): FakeGiveaway {
    const g = this.giveaways.get(id.toLowerCase());
    if (!g || g.status !== "Active")
      throw new ContractRevert("InvalidStatus", [g?.status ?? "None"]);
    return g;
  }

  private async checkSignatures(
    message: SettlementMessage,
    signatures: readonly Hex[],
  ): Promise<void> {
    let previous = 0n;
    for (const signature of signatures) {
      const signer = await recoverSettlementSigner(this.chainId, this.contract, message, signature);
      if (BigInt(signer) <= previous) throw new ContractRevert("SignersNotSorted");
      if (!this.verifiers.has(signer)) throw new ContractRevert("UnauthorizedSigner", [signer]);
      previous = BigInt(signer);
    }
  }

  private nonceOf(address: Address): number {
    return this.latest.get(address.toLowerCase()) ?? 0;
  }
}
