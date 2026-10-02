/**
 * Hosting giveaways: escrow a prize, top it up, cancel before the start, and withdraw refunds,
 * remainders and unclaimed prizes. Every function sends a transaction from the host's wallet and
 * waits for its receipt.
 */
import { fairDropsAbi } from "@fairdrops/contracts";
import { findHostedGame, sessionGameOf } from "@fairdrops/game-kit";
import {
  NATIVE_TOKEN_ADDRESS,
  contractLimits,
  encodeGiveawayMetadata,
  giveawayMetadataSchema,
  rewardPolicyOf,
  rewardPolicyProblem,
  type Address,
  type EncodedMetadata,
  type GiveawayMetadataInput,
  type Hex,
} from "@fairdrops/shared";
import {
  erc20Abi,
  parseEventLogs,
  type Account,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { fairDropsAddress, fairDropsChain, publicClientFor } from "./chain.js";

export { fairDropsAddress, fairDropsChain, publicClientFor } from "./chain.js";

export interface CreateGiveawayInput {
  chainId: number;
  /** The prize token; the zero address (NATIVE_TOKEN_ADDRESS) for the chain's native currency. */
  token: Address;
  /** Total escrowed, fee included: the prize is `amount` minus the fee. In the token's units. */
  amount: bigint;
  startTime: Date;
  /** The result must be finalized by then, or the host can take a full refund. */
  finalizeDeadline: Date;
  maxWinners: number;
  metadata: GiveawayMetadataInput;
}

export interface PreparedGiveaway {
  chainId: number;
  contract: Address;
  params: {
    token: Address;
    amount: bigint;
    startTime: bigint;
    finalizeDeadline: bigint;
    maxWinners: number;
    metadata: Hex;
  };
  /** Native currency to send with the call. */
  value: bigint;
  metadata: EncodedMetadata;
}

export class InvalidGiveawayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGiveawayError";
  }
}

/**
 * Validates a giveaway the way the contract and FairDrops will, before any transaction: the
 * schedule limits, the winner count, the metadata size, and that the reward policy fits the
 * winner count. Returns the exact arguments for `createGiveaway`.
 */
export function prepareGiveaway(input: CreateGiveawayInput, now = new Date()): PreparedGiveaway {
  const start = Math.floor(input.startTime.getTime() / 1000);
  const deadline = Math.floor(input.finalizeDeadline.getTime() / 1000);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (input.amount <= 0n) throw new InvalidGiveawayError("The amount must be positive");
  if (start < nowSeconds + contractLimits.minStartDelaySeconds) {
    throw new InvalidGiveawayError(
      `The start must be at least ${contractLimits.minStartDelaySeconds / 60} minutes away`,
    );
  }
  if (start > nowSeconds + contractLimits.maxStartDelaySeconds) {
    throw new InvalidGiveawayError("The start is too far in the future");
  }
  const window = deadline - start;
  if (
    window < contractLimits.minGameWindowSeconds ||
    window > contractLimits.maxGameWindowSeconds
  ) {
    throw new InvalidGiveawayError(
      `The finalize deadline must be ${contractLimits.minGameWindowSeconds / 60} minutes to ` +
        `${contractLimits.maxGameWindowSeconds / 86_400} days after the start`,
    );
  }
  if (input.maxWinners < 1 || input.maxWinners > contractLimits.maxWinners) {
    throw new InvalidGiveawayError(`maxWinners must be 1 to ${contractLimits.maxWinners}`);
  }
  const metadata = giveawayMetadataSchema.parse(input.metadata);
  const problem = rewardPolicyProblem(rewardPolicyOf(metadata, input.maxWinners), input.maxWinners);
  if (problem) throw new InvalidGiveawayError(problem);
  if (metadata.v === 2 && metadata.rounds) checkRounds(metadata, input.maxWinners, window);
  const encoded = encodeGiveawayMetadata(metadata);

  const token = input.token.toLowerCase() as Address;
  return {
    chainId: input.chainId,
    contract: fairDropsAddress(input.chainId),
    params: {
      token,
      amount: input.amount,
      startTime: BigInt(start),
      finalizeDeadline: BigInt(deadline),
      maxWinners: input.maxWinners,
      metadata: encoded.hex,
    },
    value: token === NATIVE_TOKEN_ADDRESS ? input.amount : 0n,
    metadata: encoded,
  };
}

/** Time the worker keeps between a game's end and the finalize deadline, to settle it. */
export const SETTLEMENT_MARGIN_SECONDS = 900;

/**
 * Rejects rounds FairDrops would refuse to run: settings a round's game doesn't accept, or a
 * schedule (every round plus the breaks) that would not end in time to settle.
 */
function checkRounds(
  metadata: Parameters<typeof sessionGameOf>[0],
  maxWinners: number,
  windowSeconds: number,
): void {
  const choice = sessionGameOf(metadata, maxWinners);
  const game = findHostedGame(choice.id, choice.version);
  if (!game) throw new InvalidGiveawayError("Rounds can only play FairDrops games");
  const parsed = game.config.safeParse(choice.config);
  if (!parsed.success) {
    throw new InvalidGiveawayError(parsed.error.issues[0]?.message ?? "Invalid round settings");
  }
  const seconds = Math.ceil(game.duration(parsed.data) / 1000);
  if (seconds > windowSeconds - SETTLEMENT_MARGIN_SECONDS) {
    throw new InvalidGiveawayError(
      `All rounds take up to ${Math.ceil(seconds / 60)} minutes, which doesn't leave time to ` +
        "settle before the finalize deadline. Use fewer rounds or shorter games.",
    );
  }
}

export interface HostOptions {
  /** Defaults to a client over the chain's public RPC. */
  publicClient?: PublicClient;
}

/**
 * Where `createGiveaway` is, for a progress display. `approve` happens only for an ERC-20 whose
 * allowance is too low (`skipped` otherwise); `signing` waits on the wallet, `confirming` on
 * the network.
 */
export type CreateProgress =
  | { step: "approve"; status: "skipped" | "signing" | "confirming" | "done" }
  | { step: "lock"; status: "signing" | "confirming" | "done" };

export interface CreateGiveawayOptions extends HostOptions {
  onProgress?: (progress: CreateProgress) => void;
}

function account(wallet: WalletClient): Account {
  if (!wallet.account) throw new Error("The wallet client has no account");
  return wallet.account;
}

async function sendAndWait(
  client: PublicClient,
  send: () => Promise<Hex>,
  onSent?: () => void,
): Promise<TransactionReceipt> {
  const hash = await send();
  onSent?.();
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return receipt;
}

/**
 * Escrows the prize and opens the giveaway. For an ERC-20 prize, approves the contract first if
 * its allowance is too low. Resolves with the giveaway id once the transaction is mined; the
 * indexer picks it up shortly after.
 */
export async function createGiveaway(
  wallet: WalletClient,
  prepared: PreparedGiveaway,
  options: CreateGiveawayOptions = {},
): Promise<{ giveawayId: Hex; transactionHash: Hex }> {
  const client = options.publicClient ?? publicClientFor(prepared.chainId);
  const chain = fairDropsChain(prepared.chainId);
  const from = account(wallet);
  const report = options.onProgress ?? (() => {});

  if (prepared.params.token === NATIVE_TOKEN_ADDRESS) {
    report({ step: "approve", status: "skipped" });
  } else {
    const allowance = await client.readContract({
      address: prepared.params.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [from.address, prepared.contract],
    });
    if (allowance < prepared.params.amount) {
      report({ step: "approve", status: "signing" });
      await sendAndWait(
        client,
        () =>
          wallet.writeContract({
            account: from,
            chain,
            address: prepared.params.token,
            abi: erc20Abi,
            functionName: "approve",
            args: [prepared.contract, prepared.params.amount],
          }),
        () => report({ step: "approve", status: "confirming" }),
      );
      report({ step: "approve", status: "done" });
    } else {
      report({ step: "approve", status: "skipped" });
    }
  }

  report({ step: "lock", status: "signing" });
  const receipt = await sendAndWait(
    client,
    () =>
      wallet.writeContract({
        account: from,
        chain,
        address: prepared.contract,
        abi: fairDropsAbi,
        functionName: "createGiveaway",
        args: [prepared.params],
        value: prepared.value,
      }),
    () => report({ step: "lock", status: "confirming" }),
  );
  report({ step: "lock", status: "done" });
  const [created] = parseEventLogs({
    abi: fairDropsAbi,
    eventName: "GiveawayCreated",
    logs: receipt.logs,
  });
  if (!created) throw new Error(`No GiveawayCreated event in ${receipt.transactionHash}`);
  return { giveawayId: created.args.id, transactionHash: receipt.transactionHash };
}

async function call(
  wallet: WalletClient,
  chainId: number,
  functionName: "cancel" | "withdraw",
  giveawayId: Hex,
  options: HostOptions,
): Promise<Hex> {
  const client = options.publicClient ?? publicClientFor(chainId);
  const receipt = await sendAndWait(client, () =>
    wallet.writeContract({
      account: account(wallet),
      chain: fairDropsChain(chainId),
      address: fairDropsAddress(chainId),
      abi: fairDropsAbi,
      functionName,
      args: [giveawayId],
    }),
  );
  return receipt.transactionHash;
}

/** Cancels before the start and refunds the whole deposit, fee included. */
export function cancelGiveaway(
  wallet: WalletClient,
  chainId: number,
  giveawayId: Hex,
  options: HostOptions = {},
): Promise<Hex> {
  return call(wallet, chainId, "cancel", giveawayId, options);
}

/**
 * Sends the host everything owed: the full deposit of a cancelled or expired giveaway (a giveaway
 * past its finalize deadline expires on this call), the undistributed remainder of a finalized
 * one, and prizes left unclaimed once the claim window closes.
 */
export function withdraw(
  wallet: WalletClient,
  chainId: number,
  giveawayId: Hex,
  options: HostOptions = {},
): Promise<Hex> {
  return call(wallet, chainId, "withdraw", giveawayId, options);
}

/** What `withdraw` would send the host right now. */
export async function withdrawable(
  chainId: number,
  giveawayId: Hex,
  options: HostOptions = {},
): Promise<bigint> {
  const client = options.publicClient ?? publicClientFor(chainId);
  return client.readContract({
    address: fairDropsAddress(chainId),
    abi: fairDropsAbi,
    functionName: "hostWithdrawable",
    args: [giveawayId],
  });
}

/** Tops up the prize before the start. */
export async function addFunds(
  wallet: WalletClient,
  chainId: number,
  giveawayId: Hex,
  token: Address,
  amount: bigint,
  options: HostOptions = {},
): Promise<Hex> {
  const client = options.publicClient ?? publicClientFor(chainId);
  const contract = fairDropsAddress(chainId);
  const native = token.toLowerCase() === NATIVE_TOKEN_ADDRESS;
  if (!native) {
    await sendAndWait(client, () =>
      wallet.writeContract({
        account: account(wallet),
        chain: fairDropsChain(chainId),
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [contract, amount],
      }),
    );
  }
  const receipt = await sendAndWait(client, () =>
    wallet.writeContract({
      account: account(wallet),
      chain: fairDropsChain(chainId),
      address: contract,
      abi: fairDropsAbi,
      functionName: "addFunds",
      args: [giveawayId, amount],
      value: native ? amount : 0n,
    }),
  );
  return receipt.transactionHash;
}

export interface TokenRef {
  chainId: number;
  /** NATIVE_TOKEN_ADDRESS for the chain's native currency. */
  address: Address;
}

/**
 * What `owner` holds of each token, in the token's smallest unit, keyed `${chainId}:${address}`.
 * Read in parallel per chain; a token that cannot be read is left out rather than shown as zero.
 */
export async function balancesOf(
  owner: Address,
  tokens: readonly TokenRef[],
  options: { publicClient?: (chainId: number) => PublicClient } = {},
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const byChain = new Map<number, TokenRef[]>();
  for (const token of tokens) {
    byChain.set(token.chainId, [...(byChain.get(token.chainId) ?? []), token]);
  }
  await Promise.all(
    [...byChain].map(async ([chainId, list]) => {
      const client = options.publicClient?.(chainId) ?? publicClientFor(chainId);
      const native = list.filter((token) => token.address === NATIVE_TOKEN_ADDRESS);
      const erc20s = list.filter((token) => token.address !== NATIVE_TOKEN_ADDRESS);
      // One call per token, in parallel: registry chains define no Multicall3 to batch with.
      const [nativeBalance, results] = await Promise.all([
        native.length ? client.getBalance({ address: owner }).catch(() => null) : null,
        Promise.allSettled(
          erc20s.map((token) =>
            client.readContract({
              address: token.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [owner],
            }),
          ),
        ),
      ]);
      if (nativeBalance !== null) out.set(`${chainId}:${NATIVE_TOKEN_ADDRESS}`, nativeBalance);
      results.forEach((result, index) => {
        const token = erc20s[index];
        if (token && result.status === "fulfilled") {
          out.set(`${chainId}:${token.address.toLowerCase()}`, result.value);
        }
      });
    }),
  );
  return out;
}
