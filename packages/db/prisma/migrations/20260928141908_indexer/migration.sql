-- CreateEnum
CREATE TYPE "OnchainStatus" AS ENUM ('ACTIVE', 'FINALIZED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GiveawayEventKind" AS ENUM ('CREATED', 'FUNDS_ADDED', 'SEED_COMMITTED', 'FINALIZED', 'CANCELLED', 'EXPIRED', 'CLAIMED', 'HOST_WITHDRAWAL');

-- CreateTable
CREATE TABLE "chain_syncs" (
    "chain_id" INTEGER NOT NULL,
    "contract_address" CHAR(42) NOT NULL,
    "cursor" CHAR(26) NOT NULL DEFAULT '0x000000000000000000000000',
    "cursor_block_hash" CHAR(66),
    "synced_block" BIGINT NOT NULL DEFAULT 0,
    "head_block" BIGINT,
    "deployment" TEXT,
    "last_error" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "halted_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chain_syncs_pkey" PRIMARY KEY ("chain_id","contract_address")
);

-- CreateTable
CREATE TABLE "giveaways" (
    "chain_id" INTEGER NOT NULL,
    "giveaway_id" CHAR(66) NOT NULL,
    "contract_address" CHAR(42) NOT NULL,
    "host" CHAR(42) NOT NULL,
    "token" CHAR(42) NOT NULL,
    "prize" DECIMAL(78,0) NOT NULL,
    "fee" DECIMAL(78,0) NOT NULL,
    "start_time" TIMESTAMPTZ(3) NOT NULL,
    "finalize_deadline" TIMESTAMPTZ(3) NOT NULL,
    "max_winners" INTEGER NOT NULL,
    "claim_window_seconds" INTEGER NOT NULL,
    "metadata_hash" CHAR(66) NOT NULL,
    "metadata_raw" BYTEA NOT NULL,
    "metadata" JSONB,
    "metadata_error" TEXT,
    "status" "OnchainStatus" NOT NULL DEFAULT 'ACTIVE',
    "seed_commitment" CHAR(66),
    "seed" CHAR(66),
    "payout_root" CHAR(66),
    "total_payout" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "winner_count" INTEGER NOT NULL DEFAULT 0,
    "transcript_hash" CHAR(66),
    "claim_deadline" TIMESTAMPTZ(3),
    "claimed" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "withdrawn" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "created_block" BIGINT NOT NULL,
    "created_tx_hash" CHAR(66) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_block" BIGINT NOT NULL,

    CONSTRAINT "giveaways_pkey" PRIMARY KEY ("chain_id","giveaway_id")
);

-- CreateTable
CREATE TABLE "giveaway_events" (
    "chain_id" INTEGER NOT NULL,
    "block_number" BIGINT NOT NULL,
    "log_index" INTEGER NOT NULL,
    "giveaway_id" CHAR(66) NOT NULL,
    "kind" "GiveawayEventKind" NOT NULL,
    "block_hash" CHAR(66) NOT NULL,
    "transaction_hash" CHAR(66) NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "account" CHAR(42),
    "recipient" CHAR(42),
    "amount" DECIMAL(78,0),
    "fee" DECIMAL(78,0),

    CONSTRAINT "giveaway_events_pkey" PRIMARY KEY ("chain_id","block_number","log_index")
);

-- CreateTable
CREATE TABLE "payout_wallets" (
    "chain_id" INTEGER NOT NULL,
    "contract_address" CHAR(42) NOT NULL,
    "account" CHAR(42) NOT NULL,
    "wallet" CHAR(42) NOT NULL,
    "updated_block" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payout_wallets_pkey" PRIMARY KEY ("chain_id","contract_address","account")
);

-- CreateIndex
CREATE INDEX "giveaways_status_start_time_idx" ON "giveaways"("status", "start_time");

-- CreateIndex
CREATE INDEX "giveaways_host_idx" ON "giveaways"("host");

-- CreateIndex
CREATE INDEX "giveaway_events_chain_id_giveaway_id_block_number_log_index_idx" ON "giveaway_events"("chain_id", "giveaway_id", "block_number", "log_index");

-- CreateIndex
CREATE INDEX "giveaway_events_account_idx" ON "giveaway_events"("account");

-- AddForeignKey
ALTER TABLE "giveaway_events" ADD CONSTRAINT "giveaway_events_chain_id_giveaway_id_fkey" FOREIGN KEY ("chain_id", "giveaway_id") REFERENCES "giveaways"("chain_id", "giveaway_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Format constraints, as in the init migration.
ALTER TABLE "chain_syncs"
  ADD CONSTRAINT "chain_syncs_contract_address_format" CHECK ("contract_address" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "chain_syncs_cursor_format" CHECK ("cursor" ~ '^0x[0-9a-f]{24}$'),
  ADD CONSTRAINT "chain_syncs_cursor_block_hash_format" CHECK ("cursor_block_hash" ~ '^0x[0-9a-f]{64}$');

ALTER TABLE "giveaways"
  ADD CONSTRAINT "giveaways_giveaway_id_format" CHECK ("giveaway_id" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "giveaways_contract_address_format" CHECK ("contract_address" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "giveaways_host_format" CHECK ("host" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "giveaways_token_format" CHECK ("token" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "giveaways_metadata_hash_format" CHECK ("metadata_hash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "giveaways_seed_commitment_format" CHECK ("seed_commitment" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "giveaways_seed_format" CHECK ("seed" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "giveaways_payout_root_format" CHECK ("payout_root" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "giveaways_transcript_hash_format" CHECK ("transcript_hash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "giveaways_created_tx_hash_format" CHECK ("created_tx_hash" ~ '^0x[0-9a-f]{64}$'),
  -- Exactly one of the parsed document and the reason it was rejected.
  ADD CONSTRAINT "giveaways_metadata_parsed" CHECK (("metadata" IS NULL) <> ("metadata_error" IS NULL));

-- The contract's accounting invariants. A projection bug fails the indexer's transaction here
-- instead of storing numbers the chain never had.
ALTER TABLE "giveaways"
  ADD CONSTRAINT "giveaways_amounts_non_negative" CHECK (
    "prize" >= 0 AND "fee" >= 0 AND "total_payout" >= 0 AND "claimed" >= 0 AND "withdrawn" >= 0
  ),
  ADD CONSTRAINT "giveaways_payout_within_prize" CHECK ("total_payout" <= "prize"),
  ADD CONSTRAINT "giveaways_claimed_within_payout" CHECK ("claimed" <= "total_payout"),
  ADD CONSTRAINT "giveaways_withdrawn_within_deposit" CHECK ("withdrawn" <= "prize" + "fee"),
  ADD CONSTRAINT "giveaways_winner_count" CHECK (
    "max_winners" > 0 AND "winner_count" >= 0 AND "winner_count" <= "max_winners"
  ),
  ADD CONSTRAINT "giveaways_schedule" CHECK ("start_time" < "finalize_deadline"),
  ADD CONSTRAINT "giveaways_finalized_fields" CHECK (
    ("status" = 'FINALIZED') = ("payout_root" IS NOT NULL AND "seed" IS NOT NULL AND "claim_deadline" IS NOT NULL)
  );

ALTER TABLE "giveaway_events"
  ADD CONSTRAINT "giveaway_events_block_hash_format" CHECK ("block_hash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "giveaway_events_transaction_hash_format" CHECK ("transaction_hash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "giveaway_events_account_format" CHECK ("account" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "giveaway_events_recipient_format" CHECK ("recipient" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "giveaway_events_amounts_non_negative" CHECK ("amount" >= 0 AND "fee" >= 0),
  ADD CONSTRAINT "giveaway_events_position" CHECK ("block_number" >= 0 AND "log_index" >= 0),
  ADD CONSTRAINT "giveaway_events_payout_fields" CHECK (
    "kind" NOT IN ('CLAIMED', 'HOST_WITHDRAWAL')
    OR ("account" IS NOT NULL AND "recipient" IS NOT NULL AND "amount" IS NOT NULL)
  );

ALTER TABLE "payout_wallets"
  ADD CONSTRAINT "payout_wallets_contract_address_format" CHECK ("contract_address" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "payout_wallets_account_format" CHECK ("account" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "payout_wallets_wallet_format" CHECK ("wallet" ~ '^0x[0-9a-f]{40}$');
