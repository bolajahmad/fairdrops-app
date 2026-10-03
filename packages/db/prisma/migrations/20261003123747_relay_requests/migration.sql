-- CreateEnum
CREATE TYPE "RelayStatus" AS ENUM ('QUEUED', 'SENT', 'MINED', 'FAILED');

-- AlterEnum
ALTER TYPE "ChainTxKind" ADD VALUE 'RELAY';

-- AlterTable
ALTER TABLE "chain_transactions" ADD COLUMN     "authorizations" JSONB;

-- CreateTable
CREATE TABLE "relay_requests" (
    "id" UUID NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "account" CHAR(42) NOT NULL,
    "user_id" UUID,
    "payload" JSONB NOT NULL,
    "fee" DECIMAL(78,0) NOT NULL,
    "fee_token" CHAR(42) NOT NULL,
    "status" "RelayStatus" NOT NULL DEFAULT 'QUEUED',
    "tx_id" UUID,
    "tx_hash" CHAR(66),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "relay_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "relay_requests_status_created_at_idx" ON "relay_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "relay_requests_account_idx" ON "relay_requests"("account");

-- AddForeignKey
ALTER TABLE "relay_requests" ADD CONSTRAINT "relay_requests_tx_id_fkey" FOREIGN KEY ("tx_id") REFERENCES "chain_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Checks
ALTER TABLE "relay_requests"
  ADD CONSTRAINT "relay_requests_account_check" CHECK ("account" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "relay_requests_fee_token_check" CHECK ("fee_token" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "relay_requests_fee_check" CHECK ("fee" >= 0),
  ADD CONSTRAINT "relay_requests_action_check"
    CHECK ("action" IN ('claim', 'withdraw', 'payoutWallet', 'execute')),
  ADD CONSTRAINT "relay_requests_tx_hash_check"
    CHECK ("tx_hash" IS NULL OR "tx_hash" ~ '^0x[0-9a-f]{64}$');
