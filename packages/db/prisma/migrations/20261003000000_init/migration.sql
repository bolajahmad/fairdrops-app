-- FairDrops schema: the whole database in one migration, for a fresh start.

-- ===== init =====

-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('EOA', 'CONTRACT');

-- CreateEnum
CREATE TYPE "WalletConnector" AS ENUM ('web3auth', 'injected', 'walletconnect', 'privy', 'other');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('x', 'instagram', 'tiktok', 'youtube', 'twitch', 'discord', 'telegram', 'github', 'website');

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('HOSTED', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "GameDefinitionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'DISABLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "handle" TEXT,
    "handle_changed_at" TIMESTAMPTZ(3),
    "display_name" TEXT,
    "bio" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "address" CHAR(42) NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "WalletKind" NOT NULL,
    "connector" "WalletConnector",
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sign_in_at" TIMESTAMPTZ(3),

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "social_links" (
    "user_id" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "handle" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_links_pkey" PRIMARY KEY ("user_id","platform")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_address" CHAR(42) NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secret_hash" CHAR(64) NOT NULL,
    "scopes" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_definitions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mode" "GameMode" NOT NULL,
    "status" "GameDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "config_schema" JSONB NOT NULL,
    "ui_url" TEXT,
    "reporter_address" CHAR(42),
    "code_hash" CHAR(66),
    "owner_id" UUID NOT NULL,
    "review_note" TEXT,
    "reviewed_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_definitions_pkey" PRIMARY KEY ("id","version")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");

-- CreateIndex
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_family_id_idx" ON "auth_sessions"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "game_definitions_owner_id_idx" ON "game_definitions"("owner_id");

-- CreateIndex
CREATE INDEX "game_definitions_status_idx" ON "game_definitions"("status");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_links" ADD CONSTRAINT "social_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_definitions" ADD CONSTRAINT "game_definitions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_definitions" ADD CONSTRAINT "game_definitions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Format constraints. The application validates first; these stop anything that slips past.
ALTER TABLE "users"
  ADD CONSTRAINT "users_handle_format" CHECK ("handle" ~ '^[a-z0-9_]{3,20}$');

ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_address_format" CHECK ("address" ~ '^0x[0-9a-f]{40}$');

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_wallet_address_format" CHECK ("wallet_address" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "auth_sessions_refresh_token_hash_format" CHECK ("refresh_token_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_secret_hash_format" CHECK ("secret_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "api_keys_scopes_known" CHECK (
    cardinality("scopes") > 0 AND "scopes" <@ ARRAY['scores:write', 'sessions:read']::TEXT[]
  );

ALTER TABLE "game_definitions"
  ADD CONSTRAINT "game_definitions_id_format" CHECK ("id" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  ADD CONSTRAINT "game_definitions_version_format" CHECK ("version" ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  ADD CONSTRAINT "game_definitions_reporter_address_format" CHECK ("reporter_address" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "game_definitions_code_hash_format" CHECK ("code_hash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "game_definitions_mode_fields" CHECK (
    ("mode" = 'EXTERNAL' AND "reporter_address" IS NOT NULL)
    OR ("mode" = 'HOSTED' AND "reporter_address" IS NULL)
  );

-- ===== indexer =====

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

-- ===== game_sessions =====

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'SEED_COMMITTED', 'LOBBY', 'RUNNING', 'SETTLING', 'FINALIZING', 'FINALIZED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" UUID NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "giveaway_id" CHAR(66) NOT NULL,
    "game_id" TEXT NOT NULL,
    "game_version" TEXT NOT NULL,
    "mode" "GameMode",
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "failure_reason" TEXT,
    "config" JSONB NOT NULL,
    "seed_ciphertext" BYTEA NOT NULL,
    "seed_commitment" CHAR(66) NOT NULL,
    "seed_commit_tx" CHAR(66),
    "seed" CHAR(66),
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "last_stream_id" TEXT NOT NULL DEFAULT '0-0',
    "action_count" INTEGER NOT NULL DEFAULT 0,
    "ranking" JSONB,
    "transcript_hash" CHAR(66),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_participants" (
    "session_id" UUID NOT NULL,
    "wallet" CHAR(42) NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_participants_pkey" PRIMARY KEY ("session_id","wallet")
);

-- CreateTable
CREATE TABLE "session_actions" (
    "session_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "player" CHAR(42) NOT NULL,
    "client_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "action" JSONB NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "reason" TEXT,

    CONSTRAINT "session_actions_pkey" PRIMARY KEY ("session_id","seq")
);

-- CreateTable
CREATE TABLE "session_transcripts" (
    "session_id" UUID NOT NULL,
    "hash" CHAR(66) NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_transcripts_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "score_reports" (
    "session_id" UUID NOT NULL,
    "reporter" CHAR(42) NOT NULL,
    "api_key_id" UUID NOT NULL,
    "ranking" JSONB NOT NULL,
    "game_transcript_hash" CHAR(66),
    "signature" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_reports_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "game_resources" (
    "hash" CHAR(66) NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_resources_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "game_sessions_status_starts_at_idx" ON "game_sessions"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "game_sessions_chain_id_giveaway_id_key" ON "game_sessions"("chain_id", "giveaway_id");

-- CreateIndex
CREATE INDEX "session_participants_user_id_idx" ON "session_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_actions_session_id_player_client_id_key" ON "session_actions"("session_id", "player", "client_id");

-- CreateIndex
CREATE INDEX "game_resources_kind_idx" ON "game_resources"("kind");

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_chain_id_giveaway_id_fkey" FOREIGN KEY ("chain_id", "giveaway_id") REFERENCES "giveaways"("chain_id", "giveaway_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_actions" ADD CONSTRAINT "session_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_transcripts" ADD CONSTRAINT "session_transcripts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_reports" ADD CONSTRAINT "score_reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_resources" ADD CONSTRAINT "game_resources_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Format constraints, as in the init migration.
ALTER TABLE "game_sessions"
  ADD CONSTRAINT "game_sessions_giveaway_id_format" CHECK ("giveaway_id" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "game_sessions_seed_commitment_format" CHECK ("seed_commitment" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "game_sessions_seed_commit_tx_format" CHECK ("seed_commit_tx" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "game_sessions_seed_format" CHECK ("seed" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "game_sessions_transcript_hash_format" CHECK ("transcript_hash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "game_sessions_last_stream_id_format" CHECK ("last_stream_id" ~ '^[0-9]+-[0-9]+$');

-- Lifecycle invariants. The runtime moves sessions with conditional updates; these catch a
-- transition that forgets a field.
ALTER TABLE "game_sessions"
  ADD CONSTRAINT "game_sessions_schedule" CHECK ("starts_at" < "ends_at"),
  ADD CONSTRAINT "game_sessions_action_count" CHECK ("action_count" >= 0),
  ADD CONSTRAINT "game_sessions_unknown_game_failed" CHECK ("mode" IS NOT NULL OR "status" = 'FAILED'),
  ADD CONSTRAINT "game_sessions_failure_reason" CHECK (
    ("status" IN ('FAILED', 'CANCELLED')) = ("failure_reason" IS NOT NULL)
  ),
  ADD CONSTRAINT "game_sessions_started" CHECK (
    "status" NOT IN ('RUNNING', 'SETTLING', 'FINALIZING', 'FINALIZED') OR "started_at" IS NOT NULL
  ),
  ADD CONSTRAINT "game_sessions_result" CHECK (
    ("status" IN ('SETTLING', 'FINALIZING', 'FINALIZED'))
    = ("ranking" IS NOT NULL AND "transcript_hash" IS NOT NULL AND "seed" IS NOT NULL AND "ended_at" IS NOT NULL)
  );

ALTER TABLE "session_participants"
  ADD CONSTRAINT "session_participants_wallet_format" CHECK ("wallet" ~ '^0x[0-9a-f]{40}$');

ALTER TABLE "session_actions"
  ADD CONSTRAINT "session_actions_player_format" CHECK ("player" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "session_actions_seq" CHECK ("seq" >= 0),
  ADD CONSTRAINT "session_actions_client_id_format" CHECK ("client_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
  ADD CONSTRAINT "session_actions_reason" CHECK ("accepted" = ("reason" IS NULL));

ALTER TABLE "score_reports"
  ADD CONSTRAINT "score_reports_reporter_format" CHECK ("reporter" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "score_reports_game_transcript_hash_format" CHECK ("game_transcript_hash" ~ '^0x[0-9a-f]{64}$');

ALTER TABLE "session_transcripts"
  ADD CONSTRAINT "session_transcripts_hash_format" CHECK ("hash" ~ '^0x[0-9a-f]{64}$');

ALTER TABLE "game_resources"
  ADD CONSTRAINT "game_resources_hash_format" CHECK ("hash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "game_resources_kind_format" CHECK ("kind" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

-- ===== settlement =====

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

-- ===== tokens =====

-- CreateTable
CREATE TABLE "tokens" (
    "chain_id" INTEGER NOT NULL,
    "address" CHAR(42) NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "decimals" SMALLINT NOT NULL,
    "listed" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("chain_id","address")
);

-- CreateIndex
CREATE INDEX "tokens_chain_id_symbol_idx" ON "tokens"("chain_id", "symbol");

-- Addresses are stored lowercase, and decimals stay in the range ERC-20s use in practice.
ALTER TABLE "tokens"
  ADD CONSTRAINT "tokens_address_lowercase" CHECK ("address" = lower("address")),
  ADD CONSTRAINT "tokens_address_format" CHECK ("address" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "tokens_decimals_range" CHECK ("decimals" BETWEEN 0 AND 36);

-- ===== sign-in identities =====

-- CreateEnum
CREATE TYPE "LoginMethod" AS ENUM ('wallet', 'google', 'email', 'passkey');

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "method" "LoginMethod" NOT NULL DEFAULT 'wallet';

-- CreateTable
CREATE TABLE "auth_identities" (
    "provider" VARCHAR(32) NOT NULL,
    "subject" VARCHAR(128) NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "LoginMethod" NOT NULL,
    "handle" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sign_in_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("provider","subject")
);

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
