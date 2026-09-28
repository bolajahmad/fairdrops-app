# FairDrops

Verifiable, multi-chain giveaways decided by skill-based games. Hosts lock a prize in a
chain-agnostic contract, players compete in games, and every payout is backed by a signed,
replayable result committed on-chain as a Merkle root.

This branch (`fairdrops/rearchitecture`) is a ground-up refactor of the original hackathon
build. The original code is preserved on `main`; nothing is carried over without being rewritten.

## Workspace

| Path                 | Package                | Purpose                                                     |
| -------------------- | ---------------------- | ----------------------------------------------------------- |
| `apps/api`           | `@fairdrops/api`       | NestJS HTTP API and plain WebSocket gateway                 |
| `apps/worker`        | `@fairdrops/worker`    | NestJS indexer consumer, scheduler, game runtime, finalizer |
| `apps/web`           | `@fairdrops/web`       | Next.js frontend                                            |
| `packages/contracts` | `@fairdrops/contracts` | FairDrops escrow (Foundry), ABI and deployment records      |
| `packages/db`        | `@fairdrops/db`        | Prisma schema, migrations and client                        |
| `packages/subgraph`  | `@fairdrops/subgraph`  | Goldsky subgraph indexing FairDrops events on each chain    |
| `packages/shared`    | `@fairdrops/shared`    | Zod schemas and inferred types shared by every app          |
| `packages/config`    | `@fairdrops/config`    | TypeScript, ESLint, Prettier and Vitest presets             |
| `infra/`             | -                      | Local Postgres, Redis and Anvil via Docker Compose          |
| `docs/legacy/`       | -                      | Reference documentation from the original build             |

## Requirements

- Node.js 24 (see `.nvmrc`)
- pnpm 12.6.0, pinned through `packageManager`. Run `corepack enable pnpm` once so the pinned
  version is used automatically.
- Docker, for local infrastructure
- [Foundry](https://getfoundry.sh), for contract work
- The [Goldsky CLI](https://docs.goldsky.com/subgraphs/deploying-subgraphs), only to deploy
  subgraphs

## Getting started

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
pnpm infra:up
pnpm --filter @fairdrops/db db:migrate
pnpm dev
```

Tests for `@fairdrops/api`, `@fairdrops/db` and `@fairdrops/worker` run against the local
Postgres and Redis, so start them with `pnpm infra:up` first. They use separate test databases
(`fairdrops_test`, and `fairdrops_test_worker` for the worker) and Redis index 15.

## Scripts

| Command             | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm build`        | Build every package in dependency order                           |
| `pnpm dev`          | Run all apps in watch mode                                        |
| `pnpm lint`         | Type-aware ESLint across the workspace                            |
| `pnpm typecheck`    | `tsc --noEmit` across the workspace                               |
| `pnpm test`         | Vitest across the workspace                                       |
| `pnpm format`       | Format with Prettier                                              |
| `pnpm format:check` | Verify formatting           
| `pnpm verify`       | Everything CI runs, in one command                                |
| `pnpm infra:up`     | Start Postgres, Redis and Anvil and wait until healthy            |
| `pnpm infra:down`   | Stop local infrastructure                                         |

Filter any task to a single package with `pnpm turbo run <task> --filter=@fairdrops/api`.

See [docs/development.md](docs/development.md) for workspace conventions, the database and
authentication, [docs/contracts.md](docs/contracts.md) for the contract design and security
review, and [docs/deployment.md](docs/deployment.md) for deploying the contracts.
