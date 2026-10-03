import { Injectable } from "@nestjs/common";
import { FAIRDROPS_ACCOUNT_ADDRESS, fairDropsAbi, fairDropsAccountAbi } from "@fairdrops/contracts";
import type { RelayCall } from "@fairdrops/settlement";
import type { Address, Hex } from "@fairdrops/shared";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { ChainClients } from "../infra/chain-clients.service.js";

export const RELAY_CHAIN = Symbol("RELAY_CHAIN");

/** An embedded wallet's EIP-7702 state. */
export interface AccountState {
  /** Whether it already points at FairDropsAccount. */
  delegated: boolean;
  /** The nonce its next batch must be signed with (FairDropsAccount's own counter). */
  nonce: bigint;
  /** Its transaction count, which an EIP-7702 authorization must carry. */
  transactionCount: number;
}

/** The chain reads gas-free actions need, behind an interface so tests can stub them. */
export interface RelayChain {
  gasPrice(chainId: number): Promise<bigint>;
  /** FairDrops' `nonces(account)`, for ClaimTo, WithdrawTo and SetPayoutWallet. */
  contractNonce(chainId: number, contract: Address, account: Address): Promise<bigint>;
  accountState(chainId: number, account: Address): Promise<AccountState>;
  hostWithdrawable(chainId: number, contract: Address, giveawayId: Hex): Promise<bigint>;
  /** Runs the relayer's transaction as a call; throws with the reason if it would fail. */
  simulate(chainId: number, from: Address, call: RelayCall): Promise<void>;
}

/** An EIP-7702 delegation shows up as code `0xef0100 ‖ delegate`. */
const DELEGATION = `0xef0100${FAIRDROPS_ACCOUNT_ADDRESS.slice(2)}`;

@Injectable()
export class ChainRelayReader implements RelayChain {
  constructor(private readonly clients: ChainClients) {}

  gasPrice(chainId: number): Promise<bigint> {
    return this.clients.get(chainId).getGasPrice();
  }

  contractNonce(chainId: number, contract: Address, account: Address): Promise<bigint> {
    return this.clients.get(chainId).readContract({
      address: contract,
      abi: fairDropsAbi,
      functionName: "nonces",
      args: [account],
    });
  }

  async accountState(chainId: number, account: Address): Promise<AccountState> {
    const client = this.clients.get(chainId);
    const [code, transactionCount] = await Promise.all([
      client.getCode({ address: account }),
      client.getTransactionCount({ address: account }),
    ]);
    const delegated = code?.toLowerCase() === DELEGATION;
    const nonce = delegated
      ? await client.readContract({
          address: account,
          abi: fairDropsAccountAbi,
          functionName: "nonce",
        })
      : 0n;
    return { delegated, nonce, transactionCount };
  }

  hostWithdrawable(chainId: number, contract: Address, giveawayId: Hex): Promise<bigint> {
    return this.clients.get(chainId).readContract({
      address: contract,
      abi: fairDropsAbi,
      functionName: "hostWithdrawable",
      args: [giveawayId],
    });
  }

  async simulate(chainId: number, from: Address, call: RelayCall): Promise<void> {
    try {
      await this.clients.get(chainId).call({
        account: from,
        to: call.to,
        data: call.data,
        value: call.value,
        ...(call.authorizationList ? { authorizationList: call.authorizationList } : {}),
      });
    } catch (error) {
      if (error instanceof BaseError) {
        const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
        throw new Error(
          revert instanceof ContractFunctionRevertedError
            ? (revert.data?.errorName ?? revert.shortMessage)
            : error.shortMessage,
        );
      }
      throw error;
    }
  }
}
