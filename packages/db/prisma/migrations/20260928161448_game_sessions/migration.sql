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
