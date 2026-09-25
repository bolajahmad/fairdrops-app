# Contracts

`packages/contracts` holds `FairDrops`, the escrow every giveaway runs through. It is plain
Solidity with no chain-specific code, compiled for the Cancun EVM and deployed through the
deterministic CREATE2 deployer, so it has the same address on every chain that shares a
configuration.

| Chain                | Chain ID  | Environment |
| -------------------- | --------- | ----------- |
| Monad Testnet        | 10143     | testnet     |
| Sepolia              | 11155111  | testnet     |
| Base Sepolia         | 84532     | testnet     |
| Polkadot Hub TestNet | 420420417 | testnet     |
| Anvil                | 31337     | local       |

The registry of chains lives in `packages/shared/src/chains.ts`. Adding a chain means adding
an entry there and an RPC alias in `packages/contracts/foundry.toml`.

## Lifecycle

```
createGiveaway -> Active --commitSeed (before start)--> Active (seed committed)
                    |                                       |
                    |- cancel (host before start,           |- finalize (verifier signatures,
                    |   operator any time) -> Cancelled     |   start <= now <= finalizeDeadline)
                    |                                       v
                    `- withdraw after finalizeDeadline    Finalized --claim / claimMany--> winners
                        -> Expired                            |
                                                              `- withdraw: remainder now,
                                                                 unclaimed after claimDeadline
```

1. **Create.** The host escrows `amount` of a token (or the native currency). The fee is
   escrowed separately and only earned if the giveaway is finalized. For ERC-20 prizes the
   escrow is the balance actually received, so fee-on-transfer tokens are accounted correctly.
2. **Commit.** An operator commits `keccak256(abi.encode(id, seed))` before the start time.
   The seed drives all game randomness and cannot change once play begins.
3. **Finalize.** After the game, verifiers sign an EIP-712 `Settlement`: the payout Merkle
   root, the total paid out, the winner count, the revealed seed and a hash of the game
   transcript. Anyone may submit it. The contract checks the seed against the commitment and
   the signatures against `VERIFIER_ROLE` and `verifierThreshold`.
4. **Claim.** Each winner, or a relayer on their behalf, claims with a Merkle proof. Leaves are
   `keccak256(keccak256(abi.encode(id, account, amount)))`, compatible with OpenZeppelin's
   `StandardMerkleTree` using `["bytes32", "address", "uint256"]`.
5. **Settle up.** The host withdraws the undistributed remainder at any time, and anything left
   unclaimed once the claim window closes. The fee recipient withdraws earned fees.

If nothing is finalized by `finalizeDeadline`, the host's next `withdraw` expires the
giveaway and refunds the whole deposit, fee included. Funds are never locked.

## Roles

| Role                 | Holder (intended)             | Powers                                                |
| -------------------- | ----------------------------- | ----------------------------------------------------- |
| `DEFAULT_ADMIN_ROLE` | Multisig behind a timelock    | Grant and revoke roles, fees, claim window, threshold |
| `VERIFIER_ROLE`      | Settlement signers (KMS keys) | Sign settlements                                      |
| `OPERATOR_ROLE`      | Game runtime                  | Commit seeds, cancel active giveaways                 |
| `PAUSER_ROLE`        | On-call key                   | Pause creation, top-ups, seed commits and finalizing  |

The admin is transferred in two steps with a delay (`AccessControlDefaultAdminRules`), and the
admin role cannot be granted directly. The deployer receives no role.

## Security review

Each item below is covered by a test in `packages/contracts/test`.

| Risk                                                     | Mitigation                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Payout signature replayed on another chain or deployment | EIP-712 domain binds `chainId` and `verifyingContract`; giveaway ids hash `chainid`, the contract address and a counter |
| Settlement replayed on the same giveaway                 | Finalization moves the giveaway out of `Active`; each account can claim once                                            |
| Single compromised verifier                              | `verifierThreshold` of distinct verifiers, signatures sorted by signer to reject duplicates                             |
| Malleable or malformed signatures                        | OpenZeppelin `ECDSA.recover` rejects high-s and invalid signatures                                                      |
| Result chosen after seeing play                          | Seed committed before start and revealed at finalize                                                                    |
| Malformed payout tree draining other giveaways           | Claims are capped at the signed `totalPayout`, which is capped at the escrowed prize                                    |
| Host funds locked when the operator disappears           | `finalizeDeadline`; afterwards the host refunds the full deposit                                                        |
| Unclaimed prizes locked forever                          | Claim window snapshotted per giveaway; afterwards the host reclaims the rest                                            |
| One failing recipient blocking every payout              | Pull-based claims; a recipient that rejects funds only affects its own claim and can set a payout wallet                |
| Reentrancy, including ERC-777 style token hooks          | `nonReentrant` on every function that moves funds, and checks-effects-interactions ordering                             |
| 2300 gas stipend of `transfer()`                         | Native payouts use `call` and revert on failure                                                                         |
| Native currency sent with an ERC-20 giveaway             | Rejected with `UnexpectedNativeValue`                                                                                   |
| Fee-on-transfer tokens                                   | Escrow is the measured balance change                                                                                   |
| Admin changing terms of running giveaways                | Fee rate and claim window are snapshotted at creation                                                                   |
| Admin taking escrowed funds                              | `sweep` only moves balance above `liabilities[token]`                                                                   |
| Pause used to trap funds                                 | Claims, cancels, withdrawals and fee withdrawals ignore the pause                                                       |
| Griefing with oversized metadata                         | Metadata capped at 4096 bytes; only its hash is stored                                                                  |

The invariant suite (`test/invariant`) runs random sequences of every action and asserts that
the contract's balance always equals what it owes, that the per-giveaway ledger sums to those
liabilities, and that no claim or withdrawal exceeds its bound. `FOUNDRY_PROFILE=ci` runs it
with 512 runs of depth 128.

### Trust assumptions

- Verifiers decide results. A threshold of compromised verifier keys can pay a prize to the
  wrong accounts, up to that giveaway's escrow. Production should use several KMS-held keys and
  a threshold above one.
- The admin can grant `VERIFIER_ROLE`, so the admin should be a multisig behind a timelock.
- Operators know the seed before play. They cannot change it, but could leak it. Games that need
  hidden randomness should derive per-round values from the seed and reveal them per round.

### Chain notes

- **Polkadot Hub** runs standard EVM bytecode on REVM. Accounts need an existential deposit, so
  a very small native payout to an empty account can fail; the winner can set a payout wallet.
  Forge tests run on Anvil, so behaviour specific to Polkadot is only covered on the testnet.
- **Rebasing tokens** are not supported: escrow accounting assumes balances only change through
  transfers.

## Development

```bash
pnpm --filter @fairdrops/contracts test          # forge test
FOUNDRY_PROFILE=ci pnpm --filter @fairdrops/contracts test
pnpm --filter @fairdrops/contracts compile       # forge build
forge coverage --report summary --no-match-coverage "test|script"   # from packages/contracts
```

Foundry is required for contract work. Dependencies (`@openzeppelin/contracts`, `forge-std`)
come from pnpm, not git submodules.

## ABI synchronization

The ABI is generated from the Foundry build and committed in three places:

| File                                     | Consumer                                 |
| ---------------------------------------- | ---------------------------------------- |
| `packages/contracts/abi/FairDrops.json`  | Tools and other languages                |
| `packages/contracts/ts/generated/abi.ts` | `@fairdrops/contracts` (API, worker)     |
| `apps/web/abi/fairDrops.ts`              | The web app (`as const`, typed for viem) |

`pnpm install` points git at `.githooks/`:

- **pre-commit** runs when the commit touches contract sources or ABI files. It rebuilds, and if
  the ABI changed it rewrites all three copies and stages them into the same commit.
- **pre-push** fails if any copy no longer matches the sources.
- **CI** runs `abi:check` on every push.

Each copy exports `fairDropsAbiHash`, a SHA-256 of the ABI, which the API also reports.

## Deploying

See [deployment.md](deployment.md) for the step-by-step runbook for local, testnet and mainnet,
including verification and troubleshooting.

## API

The API serves deployments for the environment in `DEPLOYMENT_ENVIRONMENT` (default `testnet`).

| Route                                  | Response                                       |
| -------------------------------------- | ---------------------------------------------- |
| `GET /contracts`                       | Deployments in the configured environment      |
| `GET /contracts/:environment`          | Deployments in `local`, `testnet` or `mainnet` |
| `GET /contracts/:environment/:chainId` | One deployment, or 404                         |
| `GET /contracts/abi`                   | The current ABI and its hash                   |

Each deployment includes its chain (RPC URLs, native currency, explorer), an explorer link, the
deployment block (where indexers start) and `abiCurrent`, which is false when the deployment was
built from an older ABI than the one the API serves. Response schemas are exported from
`@fairdrops/shared`.
