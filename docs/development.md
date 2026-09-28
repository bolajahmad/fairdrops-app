# Development conventions

## Dependency versions

Every third-party version is declared once in the `catalog` section of `pnpm-workspace.yaml`.
Packages reference it with `"catalog:"`, so an upgrade is a one-line change and every package
stays on the same version. Internal packages use `"workspace:*"`.

Notable pins:

- TypeScript is held at 6.0.x because `typescript-eslint` 8.x supports `<6.1.0`.
- ESLint is held at 9.x because `eslint-config-next` depends on `eslint-plugin-react`,
  `eslint-plugin-import` and `eslint-plugin-jsx-a11y`, which do not yet support ESLint 10.

pnpm 12 blocks dependency lifecycle scripts by default. Approved packages are listed under
`allowBuilds` in `pnpm-workspace.yaml`; add to it with `pnpm approve-builds <package>`. pnpm also
enforces a minimum release age, and records deliberate exceptions under `minimumReleaseAgeExclude`.

## Shared configuration

All tooling presets live in `@fairdrops/config` and each package extends them:

| Preset                 | Used by                     |
| ---------------------- | --------------------------- |
| `tsconfig/base.json`   | Everything                  |
| `tsconfig/node.json`   | Node packages               |
| `tsconfig/nest.json`   | NestJS apps (decorators)    |
| `tsconfig/nextjs.json` | Next.js app                 |
| `eslint/base`          | Type-aware rules            |
| `eslint/nest`          | NestJS apps                 |
| `eslint/next`          | Next.js app                 |
| `vitest/node`          | Node packages               |
| `vitest/nest`          | NestJS apps (SWC transform) |
| `prettier`             | Workspace root              |

## Module system

Every package is ESM (`"type": "module"`, `NodeNext` resolution). NestJS 12 ships as ESM, so
relative imports in Node packages use the `.js` extension. The Next.js app uses bundler resolution.

## NestJS and decorator metadata

Nest resolves constructor dependencies from emitted decorator metadata. Two consequences:

- Class imports used only as constructor parameter types must be value imports, not
  `import type`. The Nest ESLint preset leaves `consistent-type-imports` off for this reason.
- Vitest's default transformer does not emit decorator metadata, so the Nest test preset uses
  SWC. The API health test injects `HealthService` by type and fails if metadata is missing.

## Lint rules worth knowing

Type-aware linting is on. `no-floating-promises` and `no-misused-promises` are errors because
unawaited promises are a common source of race conditions in the game runtime.
`switch-exhaustiveness-check` keeps state machines complete when a new state is added.

## Code style

- No emoji or pictographic characters in source files, enforced by `pnpm check:emoji`.
  `docs/legacy/` is excluded because it is kept verbatim for reference.
- Inline comments only where logic is not self-evident. Longer explanations belong in `docs/`.

## Database

`@fairdrops/db` owns the Prisma schema (`packages/db/prisma/schema.prisma`), the migrations and
the generated client, which `apps/api` and `apps/worker` import.

- Change the schema, then create a migration against the local database:
  `pnpm --filter @fairdrops/db db:migrate:dev --name <change>`. Review the generated SQL and add
  any `CHECK` constraints by hand; the initial migration shows the pattern.
- Apply migrations with `pnpm --filter @fairdrops/db db:migrate`. Deployments run this as a
  release step; applications never migrate on startup, and `prisma db push` is not used.
- Store uint256 values as `DECIMAL(78, 0)` and addresses as lowercase `CHAR(42)`.
- Prisma enums use the same values as the zod enums in `@fairdrops/shared`, and
  `packages/db/test/schema.test.ts` fails if they drift.
- Change status columns with a conditional `updateMany` (`WHERE status = <expected>`) and treat
  zero affected rows as losing a race. Never read a status and then write it unconditionally.

Integration tests use the `fairdrops_test` database, created and migrated by each package's
Vitest global setup, and Redis index 15. Tests reset both before each case and run files one at
a time.

## Authentication

Everyone signs in with a wallet signature (Sign-In with Ethereum, EIP-4361). Players who sign up
with email or a social login get a Web3Auth wallet that signs the message without a prompt, so
they never see this step. The API never accepts an address from the client; it only trusts one
recovered from, or verified against, a signature over a single-use nonce.

| Endpoint                     | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `POST /auth/nonce`           | Single-use nonce for an address, valid 5 minutes             |
| `POST /auth/verify`          | Exchange a signed message for tokens                         |
| `POST /auth/refresh`         | Rotate the refresh token                                     |
| `POST /auth/logout`          | End the session and its outstanding access tokens            |
| `GET /auth/me`               | Profile, linked wallets and roles                            |
| `POST /auth/ws-ticket`       | 60-second single-use ticket for opening a WebSocket          |
| `GET /.well-known/jwks.json` | Public key for verifying access tokens, e.g. by game servers |

- **Access tokens** are ES256 JWTs valid for 15 minutes. **Refresh tokens** are random, stored
  only as a SHA-256 hash, valid for 30 days and rotated on every use. Replaying a rotated token
  more than 10 seconds later signs out every session from that sign-in; a replay inside that
  window is treated as two tabs racing.
- The web app keeps the refresh token in an `HttpOnly`, `SameSite=Strict` cookie that is only
  accepted from `APP_ORIGINS`. Other clients, such as third-party game UIs, pass
  `transport: "body"` and hold the token themselves.
- Sign-in messages are accepted from `APP_ORIGINS` and from the UI origin of every approved game.
- Wallet-link messages use a different statement from sign-in messages, so one cannot be
  replayed as the other.
- **Admins** are wallets that hold `DEFAULT_ADMIN_ROLE` on the FairDrops deployments of
  `DEPLOYMENT_ENVIRONMENT`. Admin-only routes check the contracts on each request, with a
  60-second cache, rather than trusting the token. `LOCAL_ADMIN_ADDRESSES` exists only for the
  local environment, which has no committed deployments.
- **API keys** (`X-API-Key`) authenticate game servers. They are stored as hashes, scoped, and
  shown once at creation.

Rate limits are fixed windows in Redis, so they hold across API instances.

## Git hooks

`pnpm install` sets `core.hooksPath` to `.githooks/`. The hooks keep the committed contract ABI in
sync with the Solidity sources; see [contracts.md](contracts.md#abi-synchronization).

## Local infrastructure

`infra/compose.yaml` runs Postgres 17, Redis 8 and Anvil. Defaults match `.env.example`; override
any port or credential through the shell environment. `pnpm infra:up` waits for all health checks
to pass.
