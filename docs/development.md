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

## Git hooks

`pnpm install` sets `core.hooksPath` to `.githooks/`. The hooks keep the committed contract ABI in
sync with the Solidity sources; see [contracts.md](contracts.md#abi-synchronization).

## Local infrastructure

`infra/compose.yaml` runs Postgres 17, Redis 8 and Anvil. Defaults match `.env.example`; override
any port or credential through the shell environment. `pnpm infra:up` waits for all health checks
to pass.
