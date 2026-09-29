-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PROPOSED', 'SIGNED', 'SUBMITTED', 'CONFIRMED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ChainTxKind" AS ENUM ('COMMIT_SEED', 'FINALIZE', 'CLAIM', 'CANCEL');

-- CreateEnum
CREATE TYPE "ChainTxStatus" AS ENUM ('SIGNED', 'SENT', 'MINED', 'REVERTED', 'FAILED', 'DROPPED');

-- CreateTable
CREATE TABLE "settlements" (
    "session_id" UUID NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "giveaway_id" CHAR(66) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PROPOSED',
    "policy" JSONB NOT NULL,
    "prize" DECIMAL(78,0) NOT NULL,
    "payout_root" CHAR(66) NOT NULL,
    "total_payout" DECIMAL(78,0) NOT NULL,
    "winner_count" INTEGER NOT NULL,
    "seed" CHAR(66) NOT NULL,
    "transcript_hash" CHAR(66) NOT NULL,
    "digest" CHAR(66) NOT NULL,
    "tree" JSONB NOT NULL,
    "finalize_tx_id" UUID,
    "failure_reason" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "settlement_payouts" (
    "session_id" UUID NOT NULL,
    "account" CHAR(42) NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "rank" INTEGER NOT NULL,
    "proof" TEXT[],
    "claimed_at" TIMESTAMPTZ(3),
    "claim_tx" CHAR(66),

    CONSTRAINT "settlement_payouts_pkey" PRIMARY KEY ("session_id","account")
);

-- CreateTable
CREATE TABLE "settlement_signatures" (
    "session_id" UUID NOT NULL,
    "verifier" CHAR(42) NOT NULL,
    "signature" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_signatures_pkey" PRIMARY KEY ("session_id","verifier")
);

-- CreateTable
CREATE TABLE "chain_transactions" (
    "id" UUID NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "sender" CHAR(42) NOT NULL,
    "nonce" INTEGER NOT NULL,
    "kind" "ChainTxKind" NOT NULL,
    "ref" TEXT NOT NULL,
    "to" CHAR(42) NOT NULL,
    "data" TEXT NOT NULL,
    "value" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "gas_limit" DECIMAL(78,0) NOT NULL,
    "max_fee_per_gas" DECIMAL(78,0),
    "max_priority_fee_per_gas" DECIMAL(78,0),
    "gas_price" DECIMAL(78,0),
    "raw" TEXT NOT NULL,
    "hashes" TEXT[],
    "status" "ChainTxStatus" NOT NULL DEFAULT 'SIGNED',
    "mined_hash" CHAR(66),
    "block_number" BIGINT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "settled_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chain_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlements_finalize_tx_id_key" ON "settlements"("finalize_tx_id");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_chain_id_giveaway_id_key" ON "settlements"("chain_id", "giveaway_id");

-- CreateIndex
CREATE INDEX "settlement_payouts_account_idx" ON "settlement_payouts"("account");

-- CreateIndex
CREATE INDEX "chain_transactions_chain_id_sender_nonce_idx" ON "chain_transactions"("chain_id", "sender", "nonce");

-- CreateIndex
CREATE INDEX "chain_transactions_status_idx" ON "chain_transactions"("status");

-- CreateIndex
CREATE INDEX "chain_transactions_kind_ref_idx" ON "chain_transactions"("kind", "ref");

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_finalize_tx_id_fkey" FOREIGN KEY ("finalize_tx_id") REFERENCES "chain_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_payouts" ADD CONSTRAINT "settlement_payouts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "settlements"("session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_signatures" ADD CONSTRAINT "settlement_signatures_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "settlements"("session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Format constraints, as in the init migration.
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_giveaway_id_format" CHECK ("giveaway_id" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "settlements_payout_root_format" CHECK ("payout_root" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "settlements_seed_format" CHECK ("seed" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "settlements_transcript_hash_format" CHECK ("transcript_hash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "settlements_digest_format" CHECK ("digest" ~ '^0x[0-9a-f]{64}$');

-- What finalize accepts: at least one winner, a positive total within the escrowed prize.
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_winners" CHECK ("winner_count" > 0),
  ADD CONSTRAINT "settlements_total_payout" CHECK ("total_payout" > 0 AND "total_payout" <= "prize"),
  ADD CONSTRAINT "settlements_submitted" CHECK ("status" <> 'SUBMITTED' OR "finalize_tx_id" IS NOT NULL),
  ADD CONSTRAINT "settlements_confirmed" CHECK (("status" = 'CONFIRMED') = ("confirmed_at" IS NOT NULL)),
  ADD CONSTRAINT "settlements_abandoned" CHECK (("status" = 'ABANDONED') = ("failure_reason" IS NOT NULL));

ALTER TABLE "settlement_payouts"
  ADD CONSTRAINT "settlement_payouts_account_format" CHECK ("account" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "settlement_payouts_amount" CHECK ("amount" > 0),
  ADD CONSTRAINT "settlement_payouts_rank" CHECK ("rank" > 0),
  ADD CONSTRAINT "settlement_payouts_claim_tx_format" CHECK ("claim_tx" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "settlement_payouts_claimed" CHECK (("claimed_at" IS NULL) = ("claim_tx" IS NULL));

ALTER TABLE "settlement_signatures"
  ADD CONSTRAINT "settlement_signatures_verifier_format" CHECK ("verifier" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "settlement_signatures_signature_format" CHECK ("signature" ~ '^0x[0-9a-f]{130}$');

ALTER TABLE "chain_transactions"
  ADD CONSTRAINT "chain_transactions_sender_format" CHECK ("sender" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "chain_transactions_to_format" CHECK ("to" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "chain_transactions_mined_hash_format" CHECK ("mined_hash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "chain_transactions_nonce" CHECK ("nonce" >= 0),
  ADD CONSTRAINT "chain_transactions_hashes" CHECK (cardinality("hashes") >= 1),
  ADD CONSTRAINT "chain_transactions_fees" CHECK (
    ("gas_price" IS NOT NULL) <> ("max_fee_per_gas" IS NOT NULL AND "max_priority_fee_per_gas" IS NOT NULL)
  ),
  ADD CONSTRAINT "chain_transactions_included" CHECK (
    ("status" IN ('MINED', 'REVERTED')) = ("mined_hash" IS NOT NULL AND "block_number" IS NOT NULL)
  ),
  ADD CONSTRAINT "chain_transactions_failed" CHECK ("status" <> 'FAILED' OR "error" IS NOT NULL);

-- One transaction per nonce and sender, ignoring those that never used it. The engine allocates
-- nonces under a lock; this is the backstop if two workers ever held it at once.
CREATE UNIQUE INDEX "chain_transactions_nonce_key" ON "chain_transactions"("chain_id", "sender", "nonce")
  WHERE "status" NOT IN ('FAILED', 'DROPPED');

-- At most one transaction in flight per intent, so a retried job waits for the one it sent.
CREATE UNIQUE INDEX "chain_transactions_in_flight_key" ON "chain_transactions"("kind", "ref")
  WHERE "status" IN ('SIGNED', 'SENT');

-- A game whose settlement fails (nobody qualified, the deadline passed) ends FAILED or CANCELLED
-- but keeps its result, so the result is required in the settled statuses rather than exclusive
-- to them.
ALTER TABLE "game_sessions" DROP CONSTRAINT "game_sessions_result";
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_result" CHECK (
  "status" NOT IN ('SETTLING', 'FINALIZING', 'FINALIZED')
  OR ("ranking" IS NOT NULL AND "transcript_hash" IS NOT NULL AND "seed" IS NOT NULL AND "ended_at" IS NOT NULL)
);
