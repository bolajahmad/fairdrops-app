import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import { UNIQUE_VIOLATION, Prisma } from "@fairdrops/db";
import {
  settlementTypedData,
  verifySettlement,
  type SettlementMessage,
} from "@fairdrops/settlement";
import { decodeGiveawayMetadata, type Address, type Hex } from "@fairdrops/shared";
import { keccak256 } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { Keyring } from "../chain/keyring.js";
import { FAIRDROPS_READER, type FairDropsReader } from "../chain/reader.js";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import { PRISMA, type Database } from "../infra/prisma.module.js";

const BATCH = 50;
/** How long a verifier waits before checking a proposal it refused again. */
const RECHECK_REFUSED_MS = 10 * 60_000;

/**
 * A verifier checks each proposed settlement on its own before signing it, from public data: the
 * published transcript, the host's metadata (checked against its on-chain hash) and the
 * contract's state. It does not trust the builder's payouts; it recomputes them. Several
 * verifiers with a threshold above one mean no single process can pay the wrong people.
 *
 * Runs whenever VERIFIER_PRIVATE_KEYS is set, including in a process that does nothing else.
 */
@Injectable()
export class SettlementVerifier implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(SettlementVerifier.name);
  private readonly abort = new AbortController();
  /** Proposals this process refused, until when, so each refusal is logged once per recheck. */
  private readonly refused = new Map<string, number>();
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(PRISMA) private readonly db: Database,
    @Inject(FAIRDROPS_READER) private readonly reader: FairDropsReader,
    private readonly keyring: Keyring,
  ) {}

  onApplicationBootstrap(): void {
    if (this.keyring.verifiers.length === 0 || this.env.NODE_ENV === "test") return;
    const addresses = this.keyring.verifiers.map((key) => key.address).join(", ");
    this.logger.log(`Verifying settlements as ${addresses}`);
    this.loop = this.run();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.abort.abort();
    await this.loop;
  }

  private async run(): Promise<void> {
    const { signal } = this.abort;
    while (!signal.aborted) {
      try {
        await this.tick();
      } catch (error) {
        this.logger.warn(`Verifier pass failed: ${(error as Error).message}`);
      }
      await sleep(this.env.SETTLEMENT_INTERVAL_MS, undefined, { signal }).catch(() => undefined);
    }
  }

  /** Checks and signs every proposal this process's keys have not signed yet. */
  async tick(): Promise<void> {
    for (const key of this.keyring.verifiers) {
      const verifier = key.address.toLowerCase();
      const pending = await this.db.settlement.findMany({
        where: { status: "PROPOSED", signatures: { none: { verifier } } },
        select: { sessionId: true },
        take: BATCH,
      });
      for (const { sessionId } of pending) {
        if ((this.refused.get(`${verifier}:${sessionId}`) ?? 0) > Date.now()) continue;
        await this.verify(sessionId, key).catch((error: Error) => {
          this.logger.warn(`Session ${sessionId}: verification failed: ${error.message}`);
        });
      }
    }
  }

  /**
   * Checks one proposal with one key and signs it if it holds up. Returns whether it signed.
   * Afterwards, promotes the settlement to SIGNED once enough verifiers have.
   */
  async verify(sessionId: string, key: PrivateKeyAccount): Promise<boolean> {
    const settlement = await this.db.settlement.findUnique({
      where: { sessionId },
      include: { session: { include: { giveaway: true, transcript: true } } },
    });
    if (!settlement || settlement.status !== "PROPOSED") return false;
    const { session } = settlement;
    const { giveaway } = session;
    const chainId = settlement.chainId;
    const contract = giveaway.contractAddress as Address;
    const giveawayId = settlement.giveawayId as Hex;
    const verifier = key.address.toLowerCase() as Address;

    if (!(await this.reader.isVerifier(chainId, contract, verifier))) {
      this.refuse(verifier, sessionId, `${verifier} does not hold VERIFIER_ROLE on ${chainId}`);
      return false;
    }
    if (!session.transcript) {
      this.refuse(verifier, sessionId, "The session has no published transcript");
      return false;
    }

    const onchain = await this.reader.giveaway(chainId, contract, giveawayId);
    if (onchain.status !== "Active") return false;

    // The metadata is only trusted because its hash is on-chain.
    const raw: Hex = `0x${Buffer.from(giveaway.metadataRaw).toString("hex")}`;
    if (keccak256(raw) !== onchain.metadataHash) {
      this.refuse(verifier, sessionId, "The stored metadata does not match its on-chain hash");
      return false;
    }
    const metadata = decodeGiveawayMetadata(raw);
    if (!metadata.ok) {
      this.refuse(verifier, sessionId, `Invalid metadata: ${metadata.error}`);
      return false;
    }

    let reporter: Address | undefined;
    if (session.mode === "EXTERNAL") {
      const definition = await this.db.gameDefinition.findUnique({
        where: { id_version: { id: session.gameId, version: session.gameVersion } },
        select: { reporterAddress: true },
      });
      reporter = (definition?.reporterAddress as Address | null) ?? undefined;
    }

    const message: SettlementMessage = {
      giveawayId,
      payoutRoot: settlement.payoutRoot as Hex,
      totalPayout: BigInt(settlement.totalPayout.toFixed()),
      winnerCount: settlement.winnerCount,
      seed: settlement.seed as Hex,
      transcriptHash: settlement.transcriptHash as Hex,
    };
    const result = await verifySettlement({
      chainId,
      contract,
      giveawayId,
      giveaway: {
        prize: onchain.prize,
        maxWinners: onchain.maxWinners,
        seedCommitment: onchain.seedCommitment,
      },
      metadata: metadata.metadata,
      transcript: session.transcript.content,
      settlement: message,
      reporter,
    });
    if (!result.ok) {
      const failed = result.checks.filter((check) => !check.ok);
      this.refuse(
        verifier,
        sessionId,
        failed.map((check) => `${check.name}: ${check.detail}`).join("; "),
      );
      return false;
    }

    const digest = await this.reader.settlementDigest(chainId, contract, message);
    if (digest !== settlement.digest) {
      this.refuse(
        verifier,
        sessionId,
        `The contract's digest is ${digest}, not ${settlement.digest}`,
      );
      return false;
    }

    const signature = await key.signTypedData(settlementTypedData(chainId, contract, message));
    try {
      await this.db.settlementSignature.create({ data: { sessionId, verifier, signature } });
      this.logger.log(`Session ${sessionId}: verified and signed as ${verifier}`);
    } catch (error) {
      const duplicate =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
      if (!duplicate) throw error;
    }

    await this.promote(sessionId, chainId, contract);
    return true;
  }

  /** Marks a proposal SIGNED once signatures from current verifiers reach the threshold. */
  async promote(sessionId: string, chainId: number, contract: Address): Promise<boolean> {
    const signatures = await this.db.settlementSignature.findMany({ where: { sessionId } });
    const threshold = await this.reader.verifierThreshold(chainId, contract);
    let valid = 0;
    for (const signature of signatures) {
      if (await this.reader.isVerifier(chainId, contract, signature.verifier as Address)) valid++;
    }
    if (valid < threshold) return false;
    const { count } = await this.db.settlement.updateMany({
      where: { sessionId, status: "PROPOSED" },
      data: { status: "SIGNED" },
    });
    if (count === 1) {
      this.logger.log(`Session ${sessionId}: settlement SIGNED (${valid} of ${threshold} needed)`);
    }
    return count === 1;
  }

  private refuse(verifier: string, sessionId: string, reason: string): void {
    this.refused.set(`${verifier}:${sessionId}`, Date.now() + RECHECK_REFUSED_MS);
    this.logger.error(`Session ${sessionId}: ${verifier} refuses to sign. ${reason}`);
  }
}
