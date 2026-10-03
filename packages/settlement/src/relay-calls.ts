import { fairDropsAbi, fairDropsAccountAbi } from "@fairdrops/contracts";
import {
  NATIVE_TOKEN_ADDRESS,
  type AccountCallView,
  type Address,
  type ExecutePurpose,
  type Hex,
  type RelayRequest,
  type SignedAuthorization,
} from "@fairdrops/shared";
import { decodeFunctionData, encodeFunctionData, erc20Abi, recoverTypedDataAddress } from "viem";
import { executeTypedData, relayTypedData } from "./relay.js";

/** The transaction the relayer sends for a signed action. */
export interface RelayCall {
  to: Address;
  data: Hex;
  value: bigint;
  /** For an embedded wallet's first batch: points it at FairDropsAccount (EIP-7702). */
  authorizationList?: SignedAuthorization[];
}

/**
 * Builds the relayer's transaction. `proof` is the winner's Merkle proof, which the API fills
 * in for a `claim` from the settlement, so clients never handle it.
 */
export function relayCall(
  request: RelayRequest,
  context: { contract: Address; proof?: readonly Hex[] },
): RelayCall {
  const auth = {
    nonce: BigInt(request.nonce),
    deadline: BigInt(request.deadline),
    signature: request.signature,
  };
  switch (request.action) {
    case "claim":
      return {
        to: context.contract,
        value: 0n,
        data: encodeFunctionData({
          abi: fairDropsAbi,
          functionName: "claimWithSig",
          args: [
            {
              id: request.giveawayId,
              account: request.account,
              amount: BigInt(request.amount),
              proof: [...(context.proof ?? [])],
            },
            request.recipient,
            BigInt(request.fee),
            auth,
          ],
        }),
      };
    case "withdraw":
      return {
        to: context.contract,
        value: 0n,
        data: encodeFunctionData({
          abi: fairDropsAbi,
          functionName: "withdrawWithSig",
          args: [request.giveawayId, request.recipient, BigInt(request.fee), auth],
        }),
      };
    case "payoutWallet":
      return {
        to: context.contract,
        value: 0n,
        data: encodeFunctionData({
          abi: fairDropsAbi,
          functionName: "setPayoutWalletWithSig",
          args: [request.account, request.wallet, auth],
        }),
      };
    case "execute":
      return {
        to: request.account,
        value: 0n,
        data: encodeFunctionData({
          abi: fairDropsAccountAbi,
          functionName: "execute",
          args: [
            request.calls.map((call) => ({
              to: call.to,
              value: BigInt(call.value),
              data: call.data,
            })),
            BigInt(request.deadline),
            request.signature,
          ],
        }),
        ...(request.authorization ? { authorizationList: [request.authorization] } : {}),
      };
  }
}

/** Who signed a request, recovered from its typed data. */
export async function relaySigner(request: RelayRequest, contract: Address): Promise<Address> {
  const nonce = BigInt(request.nonce);
  const deadline = BigInt(request.deadline);
  let signer: Address;
  switch (request.action) {
    case "claim":
      signer = await recoverTypedDataAddress({
        ...relayTypedData(request.chainId, contract, "ClaimTo", {
          giveawayId: request.giveawayId,
          account: request.account,
          amount: BigInt(request.amount),
          recipient: request.recipient,
          fee: BigInt(request.fee),
          nonce,
          deadline,
        }),
        signature: request.signature,
      });
      break;
    case "withdraw":
      signer = await recoverTypedDataAddress({
        ...relayTypedData(request.chainId, contract, "WithdrawTo", {
          giveawayId: request.giveawayId,
          host: request.host,
          recipient: request.recipient,
          fee: BigInt(request.fee),
          nonce,
          deadline,
        }),
        signature: request.signature,
      });
      break;
    case "payoutWallet":
      signer = await recoverTypedDataAddress({
        ...relayTypedData(request.chainId, contract, "SetPayoutWallet", {
          account: request.account,
          wallet: request.wallet,
          nonce,
          deadline,
        }),
        signature: request.signature,
      });
      break;
    case "execute":
      signer = await recoverTypedDataAddress({
        ...executeTypedData(request.chainId, request.account, {
          calls: request.calls.map((call) => ({
            to: call.to,
            value: BigInt(call.value),
            data: call.data,
          })),
          nonce,
          deadline,
        }),
        signature: request.signature,
      });
      break;
  }
  return signer.toLowerCase() as Address;
}

export class RelayRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayRejected";
  }
}

/** What an embedded wallet's batch moves, and the fee it pays the relayer. */
export interface ExecuteSummary {
  token: Address;
  /** What leaves the wallet besides the fee: the amount sent, or the prize deposited. */
  amount: bigint;
  fee: bigint;
  /** For `manage`: the giveaway changed. The API checks it's the signer's. */
  giveawayId?: Hex;
}

/**
 * The relayer only pays gas for these batches, each ending with its fee:
 *
 * - `send`: one transfer (an ERC-20 `transfer`, or the native coin), then the fee in the same
 *   token.
 * - `host`: `approve` FairDrops and `createGiveaway` (or `createGiveaway` with the native coin),
 *   then the fee in the prize token.
 * - `manage`: `cancel` (the refund pays the fee), or `approve` and `addFunds` (`addFunds` with
 *   the native coin), then the fee in the prize token. `amount` is 0 for a cancel.
 *
 * Anything else is refused, so the relayer can't be used to pay for arbitrary calls.
 */
export function checkExecuteCalls(
  calls: readonly AccountCallView[],
  purpose: ExecutePurpose,
  context: { contract: Address; relayer: Address },
): ExecuteSummary {
  const parsed = calls.map((call) => ({
    to: call.to.toLowerCase() as Address,
    value: BigInt(call.value),
    data: call.data.toLowerCase() as Hex,
  }));
  const relayer = context.relayer.toLowerCase();
  const contract = context.contract.toLowerCase();
  const fee = parsed.at(-1);
  if (!fee) throw new RelayRejected("The batch is empty");

  // The fee: an ERC-20 transfer to the relayer, or the native coin sent to it.
  let feeToken: Address;
  let feeAmount: bigint;
  if (fee.data === "0x") {
    if (fee.to !== relayer) throw new RelayRejected("The batch must end by paying the relayer");
    feeToken = NATIVE_TOKEN_ADDRESS;
    feeAmount = fee.value;
  } else {
    const transfer = erc20Call(fee.data);
    if (transfer?.functionName !== "transfer" || fee.value !== 0n) {
      throw new RelayRejected("The batch must end by paying the relayer");
    }
    const [to, amount] = transfer.args;
    if (to.toLowerCase() !== relayer) {
      throw new RelayRejected("The batch must end by paying the relayer");
    }
    feeToken = fee.to;
    feeAmount = amount;
  }

  const body = parsed.slice(0, -1);
  if (purpose === "send") {
    const [payment] = body;
    if (body.length !== 1 || !payment) throw new RelayRejected("A send is one transfer and a fee");
    if (feeToken === NATIVE_TOKEN_ADDRESS) {
      if (payment.data !== "0x" || payment.value === 0n) {
        throw new RelayRejected("Pay the fee in the token you send");
      }
      return { token: feeToken, amount: payment.value, fee: feeAmount };
    }
    const transfer = erc20Call(payment.data);
    if (payment.to !== feeToken || transfer?.functionName !== "transfer" || payment.value !== 0n) {
      throw new RelayRejected("Pay the fee in the token you send");
    }
    return {
      token: feeToken,
      amount: transfer.args[1],
      fee: feeAmount,
    };
  }

  if (purpose === "manage") return checkManage(body, feeToken, feeAmount, contract);

  // Hosting: [approve, createGiveaway] for an ERC-20 prize, [createGiveaway] for a native one.
  const create = body.at(-1);
  if (!create || create.to !== contract) throw new RelayRejected("A host batch creates a giveaway");
  const decoded = decodeFunctionData({ abi: fairDropsAbi, data: create.data });
  if (decoded.functionName !== "createGiveaway") {
    throw new RelayRejected("A host batch creates a giveaway");
  }
  const [params] = decoded.args as readonly [{ token: Address; amount: bigint }];
  const prizeToken = params.token.toLowerCase() as Address;
  if (prizeToken !== feeToken) throw new RelayRejected("Pay the fee in the prize token");
  if (prizeToken === NATIVE_TOKEN_ADDRESS) {
    if (body.length !== 1 || create.value !== params.amount) {
      throw new RelayRejected("A native prize is sent with createGiveaway");
    }
  } else {
    const [approve] = body;
    const approval = approve ? erc20Call(approve.data) : null;
    if (
      body.length !== 2 ||
      !approve ||
      approve.to !== prizeToken ||
      approval?.functionName !== "approve" ||
      approval.args[0].toLowerCase() !== contract ||
      create.value !== 0n
    ) {
      throw new RelayRejected("An ERC-20 prize is approved, then deposited");
    }
  }
  return { token: prizeToken, amount: params.amount, fee: feeAmount };
}

function checkManage(
  body: { to: Address; value: bigint; data: Hex }[],
  feeToken: Address,
  fee: bigint,
  contract: string,
): ExecuteSummary {
  const action = body.at(-1);
  if (!action || action.to !== contract) {
    throw new RelayRejected("A manage batch calls FairDrops");
  }
  const decoded = fairDropsCall(action.data);
  if (decoded?.functionName === "cancel") {
    if (body.length !== 1 || action.value !== 0n) {
      throw new RelayRejected("A cancel is the cancel and a fee");
    }
    return { token: feeToken, amount: 0n, fee, giveawayId: decoded.args[0] };
  }
  if (decoded?.functionName !== "addFunds") {
    throw new RelayRejected("A manage batch adds funds or cancels");
  }
  const [giveawayId, amount] = decoded.args;
  if (feeToken === NATIVE_TOKEN_ADDRESS) {
    if (body.length !== 1 || action.value !== amount) {
      throw new RelayRejected("Native funds are sent with addFunds");
    }
  } else {
    const [approve] = body;
    const approval = approve ? erc20Call(approve.data) : null;
    if (
      body.length !== 2 ||
      !approve ||
      approve.to !== feeToken ||
      approval?.functionName !== "approve" ||
      approval.args[0].toLowerCase() !== contract ||
      action.value !== 0n
    ) {
      throw new RelayRejected("ERC-20 funds are approved, then added");
    }
  }
  return { token: feeToken, amount, fee, giveawayId };
}

function fairDropsCall(data: Hex) {
  try {
    return decodeFunctionData({ abi: fairDropsAbi, data });
  } catch {
    return null;
  }
}

function erc20Call(data: Hex) {
  try {
    return decodeFunctionData({ abi: erc20Abi, data });
  } catch {
    return null;
  }
}
