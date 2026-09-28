-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('EOA', 'CONTRACT');

-- CreateEnum
CREATE TYPE "WalletConnector" AS ENUM ('web3auth', 'injected', 'walletconnect', 'other');

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
