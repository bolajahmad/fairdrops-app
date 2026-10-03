/**
 * Gas-free actions. Each helper asks FairDrops for the relayer's fee, has the wallet sign (a
 * typed-data signature, never a transaction), submits it, and waits until it's mined. The fee
 * comes out of what's moved, in the same token, so nobody needs the network's coin.
 *
 * Embedded wallets (Privy) also send their own funds and host giveaways this way, through the
 * FairDropsAccount delegate (EIP-7702); pass a `signAuthorization` for their first action.
 */
import { fairDropsAbi } from "@fairdrops/contracts";
import { executeTypedData, relayTypedData, type AccountCall } from "@fairdrops/settlement";
import {
  NATIVE_TOKEN_ADDRESS,
  type Address,
  type ExecutePurpose,
  type Hex,
  type RelayQuote,
  type RelayView,
  type SignedAuthorization,
} from "@fairdrops/shared";
import {
  encodeFunctionData,
  erc20Abi,
  parseEventLogs,
  type Account,
  type WalletClient,
} from "viem";
import { publicClientFor } from "./chain.js";
import type { FairDrops } from "./client.js";
import type { PreparedGiveaway } from "./host.js";

/** Signs an EIP-7702 authorization pointing the wallet at `contractAddress`. */
export type AuthorizationSigner = (input: {
  contractAddress: Address;
  chainId: number;
  nonce: number;
}) => Promise<SignedAuthorization>;

export class RelayFailed extends Error {
  constructor(readonly view: RelayView) {
    super(view.error ?? "The action didn't go through");
    this.name = "RelayFailed";
  }
}

function signer(wallet: WalletClient): { account: Account; address: Address } {
  if (!wallet.account) throw new Error("The wallet client has no account");
  return {
    account: wallet.account,
    address: wallet.account.address.toLowerCase() as Address,
  };
}

async function settle(fd: FairDrops, view: RelayView): Promise<RelayView> {
  const done = await fd.relay.wait(view.id);
  if (done.status === "FAILED") throw new RelayFailed(done);
  return done;
}

/** What a gas-free action will cost, for showing before anyone signs. */
export function quoteFee(quote: RelayQuote): bigint {
  return BigInt(quote.fee);
}

/** Collects a prize, to the winner or to any other wallet, without gas. */
export async function collectPrize(
  fd: FairDrops,
  wallet: WalletClient,
  input: {
    chainId: number;
    giveawayId: Hex;
    amount: bigint;
    token: Address;
    recipient?: Address;
    /** A quote already shown to the winner; fetched here otherwise. */
    quote?: RelayQuote;
  },
): Promise<RelayView> {
  const { account, address } = signer(wallet);
  const quote =
    input.quote ??
    (await fd.relay.quote({
      chainId: input.chainId,
      action: "claim",
      account: address,
      token: input.token,
      amount: input.amount.toString(),
    }));
  const message = {
    giveawayId: input.giveawayId,
    account: address,
    amount: input.amount,
    recipient: (input.recipient ?? address).toLowerCase() as Address,
    fee: BigInt(quote.fee),
    nonce: BigInt(quote.nonce),
    deadline: BigInt(quote.deadline),
  };
  const signature = await wallet.signTypedData({
    account,
    ...relayTypedData(input.chainId, quote.contract, "ClaimTo", message),
  });
  return settle(
    fd,
    await fd.relay.submit({
      action: "claim",
      chainId: input.chainId,
      giveawayId: message.giveawayId,
      account: address,
      amount: message.amount.toString(),
      recipient: message.recipient,
      fee: quote.fee,
      nonce: quote.nonce,
      deadline: quote.deadline,
      signature,
    }),
  );
}

/** Sends a host everything owed (refund, leftovers, unclaimed prizes) to any wallet, without gas. */
export async function withdrawGasFree(
  fd: FairDrops,
  wallet: WalletClient,
  input: {
    chainId: number;
    giveawayId: Hex;
    token: Address;
    owed: bigint;
    recipient?: Address;
    quote?: RelayQuote;
  },
): Promise<RelayView> {
  const { account, address } = signer(wallet);
  const quote =
    input.quote ??
    (await fd.relay.quote({
      chainId: input.chainId,
      action: "withdraw",
      account: address,
      token: input.token,
      amount: input.owed.toString(),
    }));
  const message = {
    giveawayId: input.giveawayId,
    host: address,
    recipient: (input.recipient ?? address).toLowerCase() as Address,
    fee: BigInt(quote.fee),
    nonce: BigInt(quote.nonce),
    deadline: BigInt(quote.deadline),
  };
  const signature = await wallet.signTypedData({
    account,
    ...relayTypedData(input.chainId, quote.contract, "WithdrawTo", message),
  });
  return settle(
    fd,
    await fd.relay.submit({
      action: "withdraw",
      chainId: input.chainId,
      giveawayId: message.giveawayId,
      host: address,
      recipient: message.recipient,
      fee: quote.fee,
      nonce: quote.nonce,
      deadline: quote.deadline,
      signature,
    }),
  );
}

/** Sends everything owed to this account to `destination` from now on, without gas. Free. */
export async function setPayoutWalletGasFree(
  fd: FairDrops,
  wallet: WalletClient,
  input: { chainId: number; destination: Address },
): Promise<RelayView> {
  const { account, address } = signer(wallet);
  const quote = await fd.relay.quote({
    chainId: input.chainId,
    action: "payoutWallet",
    account: address,
    token: NATIVE_TOKEN_ADDRESS,
    amount: "0",
  });
  const message = {
    account: address,
    wallet: input.destination.toLowerCase() as Address,
    nonce: BigInt(quote.nonce),
    deadline: BigInt(quote.deadline),
  };
  const signature = await wallet.signTypedData({
    account,
    ...relayTypedData(input.chainId, quote.contract, "SetPayoutWallet", message),
  });
  return settle(
    fd,
    await fd.relay.submit({
      action: "payoutWallet",
      chainId: input.chainId,
      account: address,
      wallet: message.wallet,
      nonce: quote.nonce,
      deadline: quote.deadline,
      signature,
    }),
  );
}

/** The fee as the batch's last call: the token (or native coin) to the relayer. */
function feeCall(token: Address, relayer: Address, fee: bigint): AccountCall {
  return token === NATIVE_TOKEN_ADDRESS
    ? { to: relayer, value: fee, data: "0x" }
    : {
        to: token,
        value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [relayer, fee] }),
      };
}

async function runBatch(
  fd: FairDrops,
  wallet: WalletClient,
  input: {
    chainId: number;
    purpose: ExecutePurpose;
    quote: RelayQuote;
    calls: AccountCall[];
    signAuthorization?: AuthorizationSigner;
    onSubmitted?: () => void;
  },
): Promise<RelayView> {
  const { account, address } = signer(wallet);
  const { quote } = input;
  const signature = await wallet.signTypedData({
    account,
    ...executeTypedData(input.chainId, address, {
      calls: input.calls,
      nonce: BigInt(quote.nonce),
      deadline: BigInt(quote.deadline),
    }),
  });
  let authorization: SignedAuthorization | undefined;
  if (quote.delegated === false) {
    if (!input.signAuthorization || !quote.delegate || quote.authorizationNonce === null) {
      throw new Error("This wallet needs to authorize FairDrops' gas-free account first");
    }
    authorization = await input.signAuthorization({
      contractAddress: quote.delegate,
      chainId: input.chainId,
      nonce: quote.authorizationNonce,
    });
  }
  const queued = await fd.relay.submit({
    action: "execute",
    purpose: input.purpose,
    chainId: input.chainId,
    account: address,
    calls: input.calls.map((call) => ({
      to: call.to,
      value: call.value.toString(),
      data: call.data,
    })),
    nonce: quote.nonce,
    deadline: quote.deadline,
    signature,
    ...(authorization ? { authorization } : {}),
  });
  input.onSubmitted?.();
  return settle(fd, queued);
}

/**
 * Sends an embedded wallet's tokens (or native coin) anywhere, without gas. The fee is paid
 * from the wallet in the same token, on top of `amount`.
 */
export async function sendFromWallet(
  fd: FairDrops,
  wallet: WalletClient,
  input: {
    chainId: number;
    token: Address;
    to: Address;
    amount: bigint;
    signAuthorization?: AuthorizationSigner;
    quote?: RelayQuote;
  },
): Promise<{ view: RelayView; fee: bigint }> {
  const { address } = signer(wallet);
  const token = input.token.toLowerCase() as Address;
  const quote =
    input.quote ??
    (await fd.relay.quote({
      chainId: input.chainId,
      action: "execute",
      purpose: "send",
      account: address,
      token,
      amount: input.amount.toString(),
    }));
  const fee = BigInt(quote.fee);
  const payment: AccountCall =
    token === NATIVE_TOKEN_ADDRESS
      ? { to: input.to, value: input.amount, data: "0x" }
      : {
          to: token,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [input.to, input.amount],
          }),
        };
  const view = await runBatch(fd, wallet, {
    chainId: input.chainId,
    purpose: "send",
    quote,
    calls: [payment, feeCall(token, quote.relayer, fee)],
    signAuthorization: input.signAuthorization,
  });
  return { view, fee };
}

/**
 * Hosts a giveaway from an embedded wallet without gas: approve FairDrops, create the giveaway
 * and pay the relayer, all in one signed batch. The wallet needs the prize plus the fee.
 */
export async function hostFromWallet(
  fd: FairDrops,
  wallet: WalletClient,
  prepared: PreparedGiveaway,
  options: {
    signAuthorization?: AuthorizationSigner;
    /** Called once the batch is built, before the wallet is asked to sign. */
    onSigning?: () => void;
    /** Called once it's submitted, while the relayer sends it. */
    onSubmitted?: () => void;
    quote?: RelayQuote;
  } = {},
): Promise<{ giveawayId: Hex; transactionHash: Hex; fee: bigint }> {
  const { address } = signer(wallet);
  const { token, amount } = prepared.params;
  const quote =
    options.quote ??
    (await fd.relay.quote({
      chainId: prepared.chainId,
      action: "execute",
      purpose: "host",
      account: address,
      token,
      amount: amount.toString(),
    }));
  const fee = BigInt(quote.fee);
  const create: AccountCall = {
    to: prepared.contract,
    value: prepared.value,
    data: encodeFunctionData({
      abi: fairDropsAbi,
      functionName: "createGiveaway",
      args: [prepared.params],
    }),
  };
  const calls: AccountCall[] =
    token === NATIVE_TOKEN_ADDRESS
      ? [create, feeCall(token, quote.relayer, fee)]
      : [
          {
            to: token,
            value: 0n,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [prepared.contract, amount],
            }),
          },
          create,
          feeCall(token, quote.relayer, fee),
        ];
  options.onSigning?.();
  const view = await runBatch(fd, wallet, {
    chainId: prepared.chainId,
    purpose: "host",
    quote,
    calls,
    signAuthorization: options.signAuthorization,
    onSubmitted: options.onSubmitted,
  });
  const receipt = await publicClientFor(prepared.chainId).getTransactionReceipt({
    hash: view.txHash!,
  });
  const [created] = parseEventLogs({
    abi: fairDropsAbi,
    eventName: "GiveawayCreated",
    logs: receipt.logs,
  });
  if (!created) throw new Error(`No GiveawayCreated event in ${view.txHash}`);
  return { giveawayId: created.args.id, transactionHash: view.txHash!, fee };
}

/**
 * Cancels a giveaway before it starts from an embedded wallet, without gas. The refund lands in
 * the wallet and the fee is paid from it. `prize` is the escrowed prize, for the quote.
 */
export async function cancelFromWallet(
  fd: FairDrops,
  wallet: WalletClient,
  input: {
    chainId: number;
    giveawayId: Hex;
    token: Address;
    prize: bigint;
    signAuthorization?: AuthorizationSigner;
  },
): Promise<RelayView> {
  const { address } = signer(wallet);
  const token = input.token.toLowerCase() as Address;
  const quote = await fd.relay.quote({
    chainId: input.chainId,
    action: "execute",
    purpose: "manage",
    account: address,
    token,
    amount: input.prize.toString(),
  });
  const cancel: AccountCall = {
    to: quote.contract,
    value: 0n,
    data: encodeFunctionData({
      abi: fairDropsAbi,
      functionName: "cancel",
      args: [input.giveawayId],
    }),
  };
  return runBatch(fd, wallet, {
    chainId: input.chainId,
    purpose: "manage",
    quote,
    calls: [cancel, feeCall(token, quote.relayer, BigInt(quote.fee))],
    signAuthorization: input.signAuthorization,
  });
}

/** Adds to a giveaway's prize before it starts from an embedded wallet, without gas. */
export async function addFundsFromWallet(
  fd: FairDrops,
  wallet: WalletClient,
  input: {
    chainId: number;
    giveawayId: Hex;
    token: Address;
    amount: bigint;
    signAuthorization?: AuthorizationSigner;
  },
): Promise<{ view: RelayView; fee: bigint }> {
  const { address } = signer(wallet);
  const token = input.token.toLowerCase() as Address;
  const quote = await fd.relay.quote({
    chainId: input.chainId,
    action: "execute",
    purpose: "manage",
    account: address,
    token,
    amount: input.amount.toString(),
  });
  const fee = BigInt(quote.fee);
  const native = token === NATIVE_TOKEN_ADDRESS;
  const add: AccountCall = {
    to: quote.contract,
    value: native ? input.amount : 0n,
    data: encodeFunctionData({
      abi: fairDropsAbi,
      functionName: "addFunds",
      args: [input.giveawayId, input.amount],
    }),
  };
  const calls: AccountCall[] = native
    ? [add, feeCall(token, quote.relayer, fee)]
    : [
        {
          to: token,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [quote.contract, input.amount],
          }),
        },
        add,
        feeCall(token, quote.relayer, fee),
      ];
  const view = await runBatch(fd, wallet, {
    chainId: input.chainId,
    purpose: "manage",
    quote,
    calls,
    signAuthorization: input.signAuthorization,
  });
  return { view, fee };
}
