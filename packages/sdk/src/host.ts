/**
 * Hosting giveaways: escrow a prize, top it up, cancel before the start, and withdraw refunds,
 * remainders and unclaimed prizes. Every function sends a transaction from the host's wallet and
 * waits for its receipt.
 */
import { fairDropsAbi } from "@fairdrops/contracts";
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

export interface HostOptions {
  /** Defaults to a client over the chain's public RPC. */
  publicClient?: PublicClient;
}

function account(wallet: WalletClient): Account {
  if (!wallet.account) throw new Error("The wallet client has no account");
  return wallet.account;
}

async function sendAndWait(
  client: PublicClient,
  send: () => Promise<Hex>,
): Promise<TransactionReceipt> {
  const hash = await send();
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
  options: HostOptions = {},
): Promise<{ giveawayId: Hex; transactionHash: Hex }> {
  const client = options.publicClient ?? publicClientFor(prepared.chainId);
  const chain = fairDropsChain(prepared.chainId);
  const from = account(wallet);

  if (prepared.params.token !== NATIVE_TOKEN_ADDRESS) {
    const allowance = await client.readContract({
      address: prepared.params.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [from.address, prepared.contract],
    });
    if (allowance < prepared.params.amount) {
      await sendAndWait(client, () =>
        wallet.writeContract({
          account: from,
          chain,
          address: prepared.params.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [prepared.contract, prepared.params.amount],
        }),
      );
    }
  }

  const receipt = await sendAndWait(client, () =>
    wallet.writeContract({
      account: from,
      chain,
      address: prepared.contract,
      abi: fairDropsAbi,
      functionName: "createGiveaway",
      args: [prepared.params],
      value: prepared.value,
    }),
  );
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
