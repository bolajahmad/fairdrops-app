# Running FairDrops

How to run the whole application with one command, and how to run each part on its own. Every command runs from the repository root unless a step says otherwise.

## What runs where

| Part                                       | Package                       | Port                                                           | What it needs                                                                                 |
| ------------------------------------------ | ----------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Web app                                    | `@fairdrops/web` (Next.js)    | 3000                                                           | The API                                                                                       |
| API (HTTP and WebSocket)                   | `@fairdrops/api` (NestJS)     | 3001 (`API_PORT`); health at `GET /health`, live play at `/ws` | Postgres, Redis                                                                               |
| Worker (indexer, game runtime, settlement) | `@fairdrops/worker` (NestJS)  | None: a background process with no HTTP port                   | Postgres, Redis, a subgraph endpoint (or indexer off), chain keys for sessions and settlement |
| Postgres 17                                | Docker (`infra/compose.yaml`) | 5432                                                           |                                                                                               |
| Redis 8                                    | Docker                        | 6379                                                           |                                                                                               |
| Anvil (contract tooling only)              | Docker, `contracts` profile   | 8545                                                           |                                                                                               |

The libraries (`shared`, `db`, `game-kit`, `settlement`, `sdk`, `contracts`) are built into `dist/` and used by the apps. Turborepo builds them first whenever an app starts, because `dev` and `build` depend on `^build`.

The API, the worker and the Prisma CLI all read the **repository root `.env`**. The web app reads **`apps/web/.env.local`**. Real deployments set the environment directly instead of using these files.

## Requirements

- **Node.js 24.** `nvm use` reads `.nvmrc`.
- **pnpm 12.6.0.** Run `corepack enable pnpm` once, so the pinned version is used.
- **Docker**, for Postgres and Redis.
- **Foundry**, only for contract work (`forge`, `anvil`, `cast`).
- **The Goldsky CLI**, only to deploy subgraphs.

## Run everything in one go

### First time

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
```

Then edit `.env`. **The worker won't start** until the indexer has somewhere to read from. Choose one:

```bash
# A: index the testnets through the Goldsky subgraphs (see docs/indexer.md)
GOLDSKY_PROJECT_ID=project_xxxxxxxx

# B: run without indexing (no giveaways arrive from the chain)
INDEXER_ENABLED=false
```

Without either, the worker stops during startup with `No subgraph endpoint for <chain>: set GOLDSKY_PROJECT_ID, or <chainId>=<url> in SUBGRAPH_ENDPOINTS`.

> **Put settings in `.env`, not on the command line, when using `pnpm dev`.** Turborepo runs in strict env mode and passes only declared variables (here just `NODE_ENV`) to the apps. So `INDEXER_ENABLED=false pnpm dev` is silently ignored, and the apps read `.env` instead. To use shell variables anyway, run `pnpm turbo run dev --env-mode=loose`. Running a built app directly (`node dist/main.js`, or `pnpm --filter <app> start`) does pass shell variables through, and they take precedence over `.env`.

For the web app, create `apps/web/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
# Match the worker's CLAIM_RELAY_ENABLED; decides whether winners see a Collect button.
NEXT_PUBLIC_CLAIM_RELAY_ENABLED=true
```

These are the only variables the web app reads: `NEXT_PUBLIC_API_URL`, `API_URL` (server-side override) and `NEXT_PUBLIC_CLAIM_RELAY_ENABLED`. Older names in an existing `.env.local` (`NEXT_PUBLIC_SERVER_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_SUBGRAPH_PUBLIC_URL`, `NEXT_PUBLIC_WEB3AUTH_ID`, `NEXT_PUBLIC_BASE_CHAIN_ENV`) come from the original build and are ignored.

### Every time

```bash
pnpm infra:up                               # Postgres and Redis, waits until healthy
pnpm --filter @fairdrops/db db:migrate      # apply any new migrations
pnpm dev                                    # builds the libraries, then runs everything in watch mode
```

`pnpm dev` runs, with one merged log stream:

- **web** on <http://localhost:3000>;
- **api** on <http://localhost:3001>;
- the **worker**;
- `tsc --watch` for `shared`, `game-kit`, `settlement` and `sdk`, so library edits reach the apps.

Stop it with `Ctrl+C`, and stop the containers with `pnpm infra:down`. Their data is kept in Docker volumes.

Check it's up:

```bash
curl http://localhost:3001/health        # {"service":"api","status":"ok",...}
open http://localhost:3000
```

The worker prints `Worker started (version …)`, then one line per chain it indexes, or `Indexer disabled`. It also warns if `OPERATOR_PRIVATE_KEY` is missing.

**A crashed worker does not stop `pnpm dev`.** Nest's watch mode keeps waiting for a file change, so the API and web keep running while the worker is dead. After starting, look for `Worker started` in the log. An `ERROR [ExceptionHandler]` line from `@fairdrops/worker` means it didn't start.

Only one `next dev` can run per app folder. If another one is already running for `apps/web`, the web task exits and Turborepo stops the whole `pnpm dev`. See Troubleshooting.

### What works with which settings

| You want                              | Set in `.env`                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Browse the app, sign in, call the API | Nothing beyond the defaults (plus the indexer choice above)                                                                               |
| Real giveaways from the testnets      | `GOLDSKY_PROJECT_ID` (optionally `GOLDSKY_API_TOKEN`); `DEPLOYMENT_ENVIRONMENT=testnet`                                                   |
| Games that actually start             | `OPERATOR_PRIVATE_KEY`: a key holding `OPERATOR_ROLE`, funded with gas on each chain. Without it, every session fails at its start.       |
| Results that get paid                 | `VERIFIER_PRIVATE_KEYS` (keys holding `VERIFIER_ROLE`); `RELAYER_PRIVATE_KEY` (defaults to the operator key), funded                      |
| Stable sign-ins across restarts       | `AUTH_JWT_PRIVATE_JWK`, from `pnpm --filter @fairdrops/api auth:generate-key` (required in production)                                    |
| Seeds that survive restarts           | `SESSION_SEED_KEY`, from `openssl rand -hex 32` (required in production)                                                                  |
| Approving games locally               | `DEPLOYMENT_ENVIRONMENT=local` and `LOCAL_ADMIN_ADDRESSES=0x…`. On testnet, admin rights come from `DEFAULT_ADMIN_ROLE` on the contracts. |

Every variable is listed with a comment in [.env.example](../.env.example). Settlement keys are covered in [settlement.md](settlement.md#keys).

### Run it like production

```bash
pnpm build                                   # every package, in dependency order
pnpm --filter @fairdrops/db db:migrate
pnpm --filter @fairdrops/api start           # node dist/main.js
pnpm --filter @fairdrops/worker start        # node dist/main.js
pnpm --filter @fairdrops/web start           # next start, port 3000
```

Run each `start` in its own terminal, or under a process manager. Set `NODE_ENV=production` along with the keys it requires: `AUTH_JWT_PRIVATE_JWK` and `SESSION_SEED_KEY`.

### Check everything the way CI does

```bash
pnpm infra:up
pnpm verify        # prettier, then lint, typecheck, test and build in every package
```

## Run each part on its own

`pnpm turbo run <task> --filter=<package>` builds the package's dependencies first. `pnpm --filter <package> <script>` runs the script alone, and expects the dependencies to be built already.

### Web app: `apps/web`

```bash
pnpm turbo run dev --filter=@fairdrops/web     # http://localhost:3000
pnpm --filter @fairdrops/web test              # Vitest
pnpm --filter @fairdrops/web build && pnpm --filter @fairdrops/web start
```

It needs a running API at `NEXT_PUBLIC_API_URL`. The routes are listed in [design/screens](design/screens/README.md). Two routes use sample data and need no backend at all:

- `/play/preview`, a local game;
- `/play/preview/results`.

### API: `apps/api`

```bash
pnpm infra:up
pnpm --filter @fairdrops/db db:migrate
pnpm turbo run dev --filter=@fairdrops/api     # http://localhost:3001, watch mode
pnpm --filter @fairdrops/api test              # needs Postgres and Redis; uses fairdrops_test and Redis db 15
```

Helper scripts:

| Command                                          | What it does                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `pnpm --filter @fairdrops/api auth:generate-key` | Prints an ES256 JWK for `AUTH_JWT_PRIVATE_JWK`                                                     |
| `pnpm --filter @fairdrops/api games:builtin`     | Prints the `POST /games` bodies that register Dice and Quiz, to submit and approve through the API |
| `pnpm --filter @fairdrops/api play …`            | Plays a full game against a running API and worker, with no chain needed (see below)               |

To run several API instances, give each its own `API_PORT`. Instances share state through Redis.

### Worker: `apps/worker`

```bash
pnpm infra:up
pnpm --filter @fairdrops/db db:migrate
pnpm turbo run dev --filter=@fairdrops/worker
pnpm --filter @fairdrops/worker test           # needs Postgres and Redis; uses fairdrops_test_worker and Redis db 14
```

Each of the worker's three jobs can be turned off:

| Job           | Switch               | Needs                                                           |
| ------------- | -------------------- | --------------------------------------------------------------- |
| Indexer       | `INDEXER_ENABLED`    | `GOLDSKY_PROJECT_ID` or `SUBGRAPH_ENDPOINTS`                    |
| Game sessions | `SESSIONS_ENABLED`   | `OPERATOR_PRIVATE_KEY` (and `SESSION_SEED_KEY` in production)   |
| Settlement    | `SETTLEMENT_ENABLED` | `VERIFIER_PRIVATE_KEYS`, and a relayer or operator key with gas |

For example, an indexer-only worker sets `SESSIONS_ENABLED=false` and `SETTLEMENT_ENABLED=false`, in its environment or `.env`. Several workers can run at once: games are shared out through Redis leases, and settlement runs on one worker at a time.

### Play a game locally, with no chain

This runs the real API, worker, Postgres, Redis, WebSocket and game runtime, while the script stands in for the chain. It uses a separate database and Redis index. Full detail is in [game-runtime.md](game-runtime.md#playing-a-game-locally).

```bash
docker exec fairdrops-postgres-1 psql -U fairdrops -d postgres -c "CREATE DATABASE fairdrops_play"
export DATABASE_URL=postgresql://fairdrops:fairdrops@localhost:5432/fairdrops_play
export REDIS_URL=redis://localhost:6379/12
export SESSION_SEED_KEY=$(openssl rand -hex 32)
pnpm --filter @fairdrops/db db:migrate
pnpm turbo run build --filter=@fairdrops/api --filter=@fairdrops/worker

# terminal 1 (same exports)
cd apps/api && API_PORT=3099 node dist/main.js
# terminal 2 (same exports)
cd apps/worker && INDEXER_ENABLED=false SESSION_PLANNER_INTERVAL_MS=500 node dist/main.js
# terminal 3 (same exports)
pnpm --filter @fairdrops/api play --api http://127.0.0.1:3099 --players 3            # dice
pnpm --filter @fairdrops/api play --api http://127.0.0.1:3099 --game quiz --questions 5
```

### Database: `packages/db`

```bash
pnpm --filter @fairdrops/db generate          # Prisma client (runs automatically before builds)
pnpm --filter @fairdrops/db db:migrate        # apply migrations (safe, used everywhere)
pnpm --filter @fairdrops/db db:migrate:dev    # create a new migration after editing schema.prisma
pnpm --filter @fairdrops/db db:reset          # DROP everything and re-apply: development data is lost
pnpm --filter @fairdrops/db db:studio         # browse the data
pnpm --filter @fairdrops/db test
```

These commands read `DATABASE_URL` from the environment, or from the root `.env`. Never use `db push`.

### Contracts: `packages/contracts`

```bash
pnpm --filter @fairdrops/contracts compile    # forge build
pnpm --filter @fairdrops/contracts test       # forge test (unit, fuzz, invariants) + Vitest
pnpm --filter @fairdrops/contracts abi:sync   # regenerate the TypeScript ABIs after changing the contract
pnpm --filter @fairdrops/contracts abi:check  # CI: fail if the ABIs are stale
```

To deploy on a local Anvil (for contract work only; the apps use testnets):

```bash
pnpm infra:contracts                           # or: anvil
cd packages/contracts
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
FAIRDROPS_ADMIN=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
FAIRDROPS_VERIFIERS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
FAIRDROPS_OPERATORS=0x90F79bf6EB2c4f870365E96eFf8e1c61C2B2d9a8 \
forge script script/Deploy.s.sol --broadcast --rpc-url anvil
```

Those are Anvil's public development keys and hold nothing of value. Testnet and mainnet deployments, with address prediction, funding, verification and `deployments:export`, are covered in [deployment.md](deployment.md).

### Subgraph: `packages/subgraph`

```bash
pnpm --filter @fairdrops/subgraph codegen
pnpm --filter @fairdrops/subgraph build
pnpm --filter @fairdrops/subgraph test                          # Matchstick
goldsky login                                                   # once
pnpm --filter @fairdrops/subgraph subgraph:deploy 1.0.0         # every indexed chain; or add a chain key
pnpm --filter @fairdrops/subgraph subgraph:promote 1.0.0        # point the worker's "prod" tag at it
```

See [indexer.md](indexer.md#deploying).

### Libraries: `packages/shared`, `game-kit`, `settlement`, `sdk`

These have no process to run. Build, watch and test them:

```bash
pnpm turbo run build --filter=@fairdrops/sdk...   # the package and everything it depends on
pnpm --filter @fairdrops/sdk dev                  # tsc --watch (also started by `pnpm dev`)
pnpm --filter @fairdrops/sdk test
pnpm --filter @fairdrops/settlement fixtures      # regenerate the contract parity fixture
```

Replace `sdk` with `shared`, `game-kit` or `settlement`. The SDK is documented in [sdk.md](sdk.md).

### End to end on testnet: `apps/e2e`

This drives a **deployed** API and worker through the SDK, on a real testnet. It is not part of `pnpm test`.

```bash
pnpm turbo run build --filter=@fairdrops/e2e...
E2E_API_URL=https://api.testnet.example \
E2E_HOST_PRIVATE_KEY=0x... \
E2E_CHAIN_ID=84532 \
pnpm --filter @fairdrops/e2e testnet
```

It needs a deployment that:

- indexes that chain;
- has funded operator and relayer keys and at least one verifier key;
- has `dice@1.0.0` approved;
- lists `E2E_ORIGIN` in the API's `APP_ORIGINS`.

Scenarios and options are in [settlement.md](settlement.md#end-to-end-on-testnet).

## Troubleshooting

| Symptom                                                                               | Cause and fix                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker exits at start with `No subgraph endpoint for …`                               | The indexer is on with no endpoint. Set `GOLDSKY_PROJECT_ID`, or `INDEXER_ENABLED=false`.                                                                                                            |
| Worker exits with `INDEXER_CHAIN_IDS includes …`                                      | That chain has no deployment or subgraph in `DEPLOYMENT_ENVIRONMENT`. Remove it from the list.                                                                                                       |
| Worker logs `OPERATOR_PRIVATE_KEY is not set` and games fail at the start             | Seeds can't be committed on-chain. Set a funded key that holds `OPERATOR_ROLE`, or use the local play script.                                                                                        |
| API or worker can't reach Postgres or Redis                                           | `pnpm infra:up`, then check the ports in `.env` (`POSTGRES_PORT`, `REDIS_PORT`) against other local services.                                                                                        |
| `The table … does not exist` / a column is missing                                    | Run `pnpm --filter @fairdrops/db db:migrate`. For tests after schema changes, drop `fairdrops_test` and `fairdrops_test_worker` and rerun.                                                           |
| The web app can't sign in or gets CORS errors                                         | Add the web origin to `APP_ORIGINS`, and check `NEXT_PUBLIC_API_URL`.                                                                                                                                |
| Everyone is signed out after restarting the API                                       | Without `AUTH_JWT_PRIVATE_JWK`, each API process makes its own key. Set one.                                                                                                                         |
| `EADDRINUSE` on 3000 or 3001                                                          | Another process holds the port. Change `API_PORT`, or run the web app on another port with `pnpm --filter @fairdrops/web exec next dev -p 3002`.                                                     |
| A library change isn't picked up                                                      | `pnpm dev` watches the libraries. When running one app alone, use `pnpm turbo run dev --filter=…` so its dependencies build first.                                                                   |
| `pnpm dev` stops with `Another next dev server is already running`                    | A `next dev` for `apps/web` is already running elsewhere; the message names its port and PID. Use that server, stop it, or run everything else with `pnpm turbo run dev --filter='!@fairdrops/web'`. |
| A variable set on the command line has no effect under `pnpm dev` or `pnpm turbo run` | Turborepo's strict env mode drops undeclared variables. Put it in `.env`, or add `--env-mode=loose`.                                                                                                 |
| Wrong pnpm or Node version errors                                                     | `corepack enable pnpm` and Node 24 (`nvm use`).                                                                                                                                                      |
