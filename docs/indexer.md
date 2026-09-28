# Indexer

Every giveaway starts on-chain, so the database learns about giveaways, top-ups, results, claims
and refunds from FairDrops contract events. Two pieces do this:

- `packages/subgraph`, a subgraph deployed to Goldsky once per chain. It turns the
  contract's logs into a single, chain-ordered feed of events.
- **The indexer in** `apps/worker`, which copies that feed into Postgres and builds the
  giveaway tables the API reads.

```
FairDrops contract --logs--> Goldsky subgraph (per chain) --GraphQL, pulled--> worker indexer
                                                                                   |
                                                         one transaction per batch v
                                        giveaways, giveaway_events, payout_wallets, chain_syncs
```

Nothing writes these tables except the indexer, and every row traces back to a contract event.
The API and web app never query the subgraph themselves.

## Chains

| Chain                | Chain ID  | Goldsky network | Indexed                                 |
| -------------------- | --------- | --------------- | --------------------------------------- |
| Monad Testnet        | 10143     | `monad-testnet` | Yes                                     |
| Sepolia              | 11155111  | `sepolia`       | Yes                                     |
| Base Sepolia         | 84532     | `base-sepolia`  | Yes                                     |
| Polkadot Hub TestNet | 420420417 | none            | No: Goldsky does not support it         |
| Anvil                | 31337     | none            | No: local deployments are not committed |

A chain is indexed when its registry entry in `packages/shared/src/chains.ts` has a
`subgraphNetwork` and `packages/contracts/deployments` has a FairDrops deployment on it. The
subgraph's start block is the deployment block from that record, so nothing is configured twice.

## The subgraph

`schema.graphql` defines two entities:

- `FairDropsEvent` is immutable, one row per FairDrops log, covering every event in the ABI:
  giveaway lifecycle, payout wallets, fees, configuration, roles and pausing. Its id is the block
  number (8 bytes) followed by the log index (4 bytes), big-endian, so sorting by id is chain
  order and `id_gt` is a cursor. Parameters keep their Solidity names.
- `Giveaway` is the current state of each giveaway, for GraphQL consumers such as explorers
  and result verifiers. The worker does not read it.

Role and pause events are indexed so anyone can check which verifiers could sign a settlement
at a given block.

`subgraph.template.yaml` is rendered into `subgraph.<chain key>.yaml` for each indexed chain by
`scripts/subgraph.ts`. The rendered files, `generated/` and `build/` are gitignored.

```bash
pnpm --filter @fairdrops/subgraph build     # codegen, then one build per chain in build/<key>
pnpm --filter @fairdrops/subgraph test      # Matchstick unit tests for the mappings
```

### Deploying

Each chain has its own Goldsky subgraph named `fairdrops-<chain key>`, for example
`fairdrops-monad-testnet`. The worker reads the `prod` tag, so a new version only goes live when
you move the tag.

1. Log in once: `goldsky login`.
2. Deploy a version to every indexed chain, or name specific chains:

```bash
 pnpm --filter @fairdrops/subgraph subgraph:deploy 1.0.0
 pnpm --filter @fairdrops/subgraph subgraph:deploy 1.0.1 base-sepolia
```

3. Wait until each deployment has caught up with its chain (`goldsky subgraph list`, or the
   dashboard), then point the worker at it:

```bash
pnpm --filter @fairdrops/subgraph subgraph:promote 1.0.0
```

4. Set `GOLDSKY_PROJECT_ID` on the worker, and `GOLDSKY_API_TOKEN` to read the private endpoints.

Promoting a version whose entities are unchanged needs nothing else: event ids are derived from
the chain, so the worker carries on from its cursor. If a new version changes what is recorded
for existing events, reset the affected chains after promoting (see Operations).

## Copying into Postgres

For each chain the worker runs a loop in `apps/worker/src/indexer`:

1. Read the subgraph's head block. The **safe block** is the head minus the chain's
   `confirmations` from the registry. Nothing newer is copied, so short reorgs never reach the
   database.
2. Query up to `INDEXER_BATCH_SIZE` events with an id after the stored cursor, up to the safe
   block. The same query re-reads the event at the cursor and returns the block the replica
   answered at.
3. In **one transaction**: take a Postgres advisory lock for the chain, move the cursor
   (conditional on it not having moved), and apply each event in order.
4. If the batch was full, fetch the next one straight away. Otherwise wait
   `INDEXER_POLL_INTERVAL_MS`.

Because the cursor and the rows it produced commit together, each event is applied exactly once
through crashes, restarts and redeploys. Two workers on the same chain are safe: the second
finds the lock taken or the cursor moved, discards its batch and reports `busy`.

`chain_syncs.synced_block` means every event up to that block is in the database. It only
advances to the block the answering replica had indexed, even when another replica reported a
higher head.

### What each event does

| Event               | `giveaways`                                                      | `giveaway_events` |
| ------------------- | ---------------------------------------------------------------- | ----------------- |
| `GiveawayCreated`   | Inserts the giveaway; checks and parses the metadata             | `CREATED`         |
| `FundsAdded`        | Adds to `prize` and `fee` (must be `ACTIVE`)                     | `FUNDS_ADDED`     |
| `SeedCommitted`     | Sets `seed_commitment` (must be `ACTIVE`, not yet committed)     | `SEED_COMMITTED`  |
| `GiveawayFinalized` | `FINALIZED`, with payout root, seed, transcript and claim window | `FINALIZED`       |
| `GiveawayCancelled` | `CANCELLED` (must be `ACTIVE`)                                   | `CANCELLED`       |
| `GiveawayExpired`   | `EXPIRED` (must be `ACTIVE`)                                     | `EXPIRED`         |
| `Claimed`           | Adds to `claimed` (must be `FINALIZED`)                          | `CLAIMED`         |
| `HostWithdrawal`    | Adds to `withdrawn` (must be finalized, cancelled or expired)    | `HOST_WITHDRAWAL` |
| `PayoutWalletSet`   | Upserts `payout_wallets`, or deletes the row when set to zero    | none              |
| Everything else     | Nothing; it stays in the subgraph                                | none              |

The status each event requires is the one the contract required to emit it, so an event that
does not fit means the copied history is wrong. The migration also enforces the contract's
accounting as `CHECK` constraints: the payout never exceeds the prize, claims never exceed the
payout, withdrawals never exceed the deposit, and the settlement fields are set exactly when a
giveaway is finalized.

### Metadata

The host's metadata is emitted in full in `GiveawayCreated` and only its hash is stored
on-chain. The indexer checks `keccak256(metadata) == metadataHash`, which catches a faulty
indexer, since the contract computed the hash. It then parses the document with
`decodeGiveawayMetadata` from `@fairdrops/shared`. A giveaway whose metadata is invalid is still
stored, with `metadata` null and the reason in `metadata_error`; it is shown as `invalid` and never
played.

## Failures

| Failure                                                       | Behaviour                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Subgraph unreachable, 5xx, GraphQL error                      | Retried with exponential backoff up to 60 s; `last_error` is set  |
| Rate limited (429)                                            | Waits for `Retry-After`                                           |
| Subgraph reports indexing errors                              | Keeps copying what is indexed; `last_error` says where it stopped |
| Event that does not fit the stored state, or breaks a `CHECK` | **Halts** the chain; nothing from the batch is written            |
| Metadata that does not match its hash, or a malformed event   | **Halts** the chain                                               |
| Event at the cursor has a different block hash, or is gone    | **Halts** the chain: a reorg went deeper than the confirmations   |

A halted chain sets `chain_syncs.halted_at` with the reason in `last_error`, logs it once, and
re-checks every minute. The other chains carry on.

## Operations

Inspect progress:

```sql
SELECT chain_id, synced_block, head_block, head_block - synced_block AS lag,
       deployment, last_error, halted_at
FROM chain_syncs;
```

**Resume after fixing the cause** of a halt that did not corrupt anything, for example a
subgraph bug fixed by a new version:

```sql
UPDATE chain_syncs SET halted_at = NULL, last_error = NULL WHERE chain_id = 10143;
```

**Resync a chain from scratch**, after a deep reorg or a subgraph version that records events
differently: stop the worker (or let it stay halted) and call `resetChain` from
`apps/worker/src/indexer/chain-indexer.ts`, or run the equivalent SQL in one transaction:

```sql
BEGIN;
DELETE FROM giveaway_events WHERE (chain_id, giveaway_id) IN
  (SELECT chain_id, giveaway_id FROM giveaways
   WHERE chain_id = 10143 AND contract_address = '0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca');
DELETE FROM giveaways
  WHERE chain_id = 10143 AND contract_address = '0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca';
DELETE FROM payout_wallets
  WHERE chain_id = 10143 AND contract_address = '0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca';
DELETE FROM chain_syncs
  WHERE chain_id = 10143 AND contract_address = '0x40e79f68ae9ad9a28942050c5158a26d9c9e60ca';
COMMIT;
```

Once other tables reference giveaways (game sessions, for example), resetting will need to
account for them.

## Configuration

| Variable                   | Default   | Meaning                                                         |
| -------------------------- | --------- | --------------------------------------------------------------- |
| `DEPLOYMENT_ENVIRONMENT`   | `testnet` | Which chains to index                                           |
| `INDEXER_ENABLED`          | `true`    | Turn the loops off, for example on a worker that only runs jobs |
| `INDEXER_CHAIN_IDS`        | all       | Comma-separated chain ids to index                              |
| `INDEXER_POLL_INTERVAL_MS` | `4000`    | Pause between polls once caught up                              |
| `INDEXER_BATCH_SIZE`       | `500`     | Events per transaction, at most 1000                            |
| `GOLDSKY_PROJECT_ID`       |           | Goldsky project; endpoints are derived from it                  |
| `GOLDSKY_API_TOKEN`        |           | Read the private endpoints instead of the public ones           |
| `SUBGRAPH_ENDPOINTS`       |           | `chainId=url` pairs overriding the Goldsky endpoint per chain   |

Public Goldsky endpoints allow 50 requests per 10 seconds. Caught up, each chain makes two
requests per poll, so three chains at the default interval use about 15 of them. Use the private
endpoints in production.

## Adding a chain

1. Deploy the contract and record it (see [deployment.md](deployment.md)).
2. Check that Goldsky supports the chain for subgraphs, and set `subgraphNetwork` in its
   registry entry to Goldsky's network name.
3. Deploy and promote the subgraph for it:
   `pnpm --filter @fairdrops/subgraph subgraph:deploy <version> <chain key>`, then `subgraph:promote`.

The worker picks the chain up on its next start.

## Compared with the original build

The indexer on `main` polled the subgraph every 10 seconds for the 50 newest `GiveawayCreated`
events, compared them with every giveaway id in the database, and read each new giveaway's start
time and winner count from the contract. This version keeps the idea of polling the subgraph
and creating giveaways only from on-chain events, and changes how it is done:

| Original                                                      | Now                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| One chain, one contract                                       | Every indexable chain, each with its own cursor                              |
| Only `GiveawayCreated`; top-ups and cancellations were missed | Every event, applied in chain order, so the database matches the contract    |
| The 50 newest events; more in one interval were lost          | A cursor over all events, in batches                                         |
| Loaded every known id on every poll                           | Constant work per poll                                                       |
| Read fields from the contract over RPC                        | Every field comes from the event itself                                      |
| No confirmations; reorged events could be stored              | Copies only confirmed blocks, and halts on a deeper reorg                    |
| Separate writes, duplicates caught by a unique error          | One transaction per batch with the cursor; exactly once, safe across workers |
| Metadata trusted as sent                                      | Checked against the on-chain hash and validated                              |
