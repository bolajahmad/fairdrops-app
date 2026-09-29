import { Inject, Injectable } from "@nestjs/common";
import type { Address, Hex } from "@fairdrops/shared";
import type { SettlementMessage } from "@fairdrops/settlement";
import { keccak256, toHex } from "viem";
import { CHAIN_RPC, type ChainRpcFactory } from "./rpc.js";

const STATUSES = ["None", "Active", "Finalized", "Cancelled", "Expired"] as const;
export type OnchainGiveawayStatus = (typeof STATUSES)[number];

const VERIFIER_ROLE = keccak256(toHex("VERIFIER_ROLE"));

/** The parts of `getGiveaway(id)` settlement depends on. */
export interface OnchainGiveaway {
  status: OnchainGiveawayStatus;
  host: Address;
  prize: bigint;
  maxWinners: number;
  startTime: number;
  finalizeDeadline: number;
  metadataHash: Hex;
  seedCommitment: Hex;
  payoutRoot: Hex;
  transcriptHash: Hex;
  totalPayout: bigint;
  claimDeadline: number;
}

/** Reads FairDrops state straight from the chain, never from the indexed copy. */
export interface FairDropsReader {
  giveaway(chainId: number, contract: Address, id: Hex): Promise<OnchainGiveaway>;
  verifierThreshold(chainId: number, contract: Address): Promise<number>;
  isVerifier(chainId: number, contract: Address, account: Address): Promise<boolean>;
  settlementDigest(chainId: number, contract: Address, settlement: SettlementMessage): Promise<Hex>;
  isClaimed(chainId: number, contract: Address, id: Hex, account: Address): Promise<boolean>;
}

export const FAIRDROPS_READER = Symbol("FAIRDROPS_READER");

interface RawGiveaway {
  host: Address;
  startTime: bigint;
  maxWinners: number;
  finalizeDeadline: bigint;
  status: number;
  claimDeadline: bigint;
  prize: bigint;
  totalPayout: bigint;
  metadataHash: Hex;
  seedCommitment: Hex;
  payoutRoot: Hex;
  transcriptHash: Hex;
}

@Injectable()
export class OnchainFairDropsReader implements FairDropsReader {
  constructor(@Inject(CHAIN_RPC) private readonly rpc: ChainRpcFactory) {}

  async giveaway(chainId: number, contract: Address, id: Hex): Promise<OnchainGiveaway> {
    const g = await this.rpc(chainId).read<RawGiveaway>(contract, "getGiveaway", [id]);
    return {
      status: STATUSES[g.status] ?? "None",
      host: g.host.toLowerCase() as Address,
      prize: g.prize,
      maxWinners: Number(g.maxWinners),
      startTime: Number(g.startTime),
      finalizeDeadline: Number(g.finalizeDeadline),
      metadataHash: g.metadataHash,
      seedCommitment: g.seedCommitment,
      payoutRoot: g.payoutRoot,
      transcriptHash: g.transcriptHash,
      totalPayout: g.totalPayout,
      claimDeadline: Number(g.claimDeadline),
    };
  }

  async verifierThreshold(chainId: number, contract: Address): Promise<number> {
    return Number(await this.rpc(chainId).read<number>(contract, "verifierThreshold", []));
  }

  isVerifier(chainId: number, contract: Address, account: Address): Promise<boolean> {
    return this.rpc(chainId).read<boolean>(contract, "hasRole", [VERIFIER_ROLE, account]);
  }

  settlementDigest(chainId: number, contract: Address, s: SettlementMessage): Promise<Hex> {
    return this.rpc(chainId).read<Hex>(contract, "settlementDigest", [
      s.giveawayId,
      {
        payoutRoot: s.payoutRoot,
        totalPayout: s.totalPayout,
        winnerCount: s.winnerCount,
        seed: s.seed,
        transcriptHash: s.transcriptHash,
      },
    ]);
  }

  isClaimed(chainId: number, contract: Address, id: Hex, account: Address): Promise<boolean> {
    return this.rpc(chainId).read<boolean>(contract, "isClaimed", [id, account]);
  }
}
