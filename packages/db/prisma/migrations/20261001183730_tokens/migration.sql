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
