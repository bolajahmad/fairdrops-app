# Deploying the contracts

This is the runbook for deploying `FairDrops` to each environment. The contract design and
security review are in [contracts.md](contracts.md).

All commands run from the repository root unless a step says otherwise.

## How a deployment works

- `script/Deploy.s.sol` deploys through the deterministic CREATE2 deployer at
  `0x4e59b44847b379578588920cA78FbF26c0B4956C`. The address depends only on the salt, the
  compiled bytecode and the constructor arguments, so the same configuration gives the same
  address on every chain.
- The script is idempotent. If the contract already exists at the predicted address it logs
  `FairDrops already deployed at ...` and sends nothing, so a failed multi-chain rollout can be
  re-run safely.
- The deployer key only pays gas. It receives no role unless you list its address as one.
- After deploying, `deployments:export` turns the broadcast receipts into
  `packages/contracts/deployments/<chainId>.json`, which the API serves from `GET /contracts`.

| Environment | Chains                                                     | API `DEPLOYMENT_ENVIRONMENT` |
| ----------- | ---------------------------------------------------------- | ---------------------------- |
| `local`     | Anvil (31337)                                              | `local`                      |
| `testnet`   | Monad Testnet, Sepolia, Base Sepolia, Polkadot Hub TestNet | `testnet`                    |
| `mainnet`   | None yet. Add chains to the registry first (see the end)   | `mainnet`                    |

## Prerequisites

- Node.js 24 and pnpm (`corepack enable pnpm`), then `pnpm install`.
- Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
- `jq`, only for the verification commands.

Check that the build and tests pass before deploying:

```bash
pnpm --filter @fairdrops/contracts test
pnpm --filter @fairdrops/contracts abi:check
```

## Configuration

Create `packages/contracts/.env` from the template. Forge loads it automatically, and it is
gitignored.

```bash
cp packages/contracts/.env.example packages/contracts/.env
```

| Variable                       | Required | Default                     | Meaning                                        |
| ------------------------------ | -------- | --------------------------- | ---------------------------------------------- |
| `DEPLOYER_PRIVATE_KEY`         | yes      |                             | Pays for the deployment. With or without `0x`. |
| `FAIRDROPS_ADMIN`              | yes      |                             | Default admin (roles, fees, unpause, sweep)    |
| `FAIRDROPS_VERIFIERS`          | yes      |                             | Comma-separated settlement signers             |
| `FAIRDROPS_OPERATORS`          | yes      |                             | Comma-separated seed committers and cancellers |
| `FAIRDROPS_PAUSERS`            | no       | none                        | Comma-separated pausers                        |
| `FAIRDROPS_FEE_RECIPIENT`      | no       | `FAIRDROPS_ADMIN`           | Receives earned fees                           |
| `FAIRDROPS_ADMIN_DELAY`        | no       | `172800` (2 days)           | Delay on admin transfers, in seconds           |
| `FAIRDROPS_FEE_BPS`            | no       | `100` (1%)                  | Fee, at most 500                               |
| `FAIRDROPS_CLAIM_WINDOW`       | no       | `2592000` (30 days)         | Claim window, 7 to 365 days                    |
| `FAIRDROPS_VERIFIER_THRESHOLD` | no       | `1`                         | Signatures required to finalize                |
| `FAIRDROPS_SALT`               | no       | `keccak256("fairdrops.v1")` | CREATE2 salt                                   |

Every value except `DEPLOYER_PRIVATE_KEY` is part of the address. Changing any of them, or the
order of an address list, produces a different address. Keep them identical across all chains in
an environment, and change `FAIRDROPS_SALT` when you intentionally want a fresh address.

## Local (Anvil)

For development against the API and web app. Nothing from this environment is committed.

1. Start Anvil, either standalone or with the rest of the local stack:

   ```bash
   anvil                 # or: pnpm infra:up
   ```

2. Deploy with Anvil's first development account. The key below is Anvil's public test key and
   holds nothing of value; do not use it anywhere else.

   ```bash
   cd packages/contracts
   DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
   FAIRDROPS_ADMIN=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
   FAIRDROPS_VERIFIERS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
   FAIRDROPS_OPERATORS=0x90F79bf6EB2c4f870365E96eFf8e1c61C2B2d9a8 \
   forge script script/Deploy.s.sol --broadcast --rpc-url anvil
   ```

   Inline variables override `.env`, so this does not touch your testnet configuration.

3. Anvil resets on restart, so re-run step 2 after every restart. `deployments:export` skips
   local chains on purpose.

## Testnet

Chains: `monad-testnet`, `sepolia`, `base-sepolia` and `polkadot-hub-testnet`. The names are
RPC aliases defined in `packages/contracts/foundry.toml`.

### 1. Configure

Fill in `packages/contracts/.env` as described above.

### 2. Predict the address

```bash
cd packages/contracts
forge script script/Deploy.s.sol --sig "predict()"
```

Save the address; every chain should end up with this one.

### 3. Fund the deployer

Print the deployer address, then check its balance on every chain:

```bash
cd packages/contracts
set -a && . ./.env && set +a
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
for chain in monad-testnet sepolia base-sepolia polkadot-hub-testnet; do
  echo "$chain: $(cast balance "$DEPLOYER" --ether --rpc-url "$chain")"
done
```

The deployment uses about 4.2M gas. Forge checks the balance against its estimate before
broadcasting, which on Polkadot Hub is about 11 PAS even though the deployment costs about 1 PAS.
Keep at least:

| Chain                | Native token | Keep at least | Faucet                                           |
| -------------------- | ------------ | ------------- | ------------------------------------------------ |
| Monad Testnet        | MON          | 1 MON         | https://faucet.monad.xyz                         |
| Sepolia              | ETH          | 0.05 ETH      | https://www.alchemy.com/faucets/ethereum-sepolia |
| Base Sepolia         | ETH          | 0.01 ETH      | https://docs.base.org/get-started/get-funds      |
| Polkadot Hub TestNet | PAS          | 15 PAS        | https://faucet.polkadot.io                       |

### 4. Deploy

Deploy one chain at a time:

```bash
pnpm --filter @fairdrops/contracts deploy:contract monad-testnet
pnpm --filter @fairdrops/contracts deploy:contract sepolia
pnpm --filter @fairdrops/contracts deploy:contract base-sepolia
pnpm --filter @fairdrops/contracts deploy:contract polkadot-hub-testnet
```

Each run ends with `FairDrops deployed at <address>` or, when it is already there,
`FairDrops already deployed at <address>`. The address must match step 2 on every chain; the
script reverts with `unexpected deployment address` if it does not.

Do not send other transactions from the deployer wallet while a deployment is pending. Forge
picks the nonce when it signs, so a transfer sent in the meantime takes that nonce and the
deployment is dropped without an error on-chain. If that happens, re-run the same command.

### 5. Confirm on-chain

```bash
cd packages/contracts
ADDRESS=<address from step 2>
for chain in monad-testnet sepolia base-sepolia polkadot-hub-testnet; do
  echo "$chain: admin $(cast call "$ADDRESS" "defaultAdmin()(address)" --rpc-url "$chain") \
fee $(cast call "$ADDRESS" "feeBps()(uint16)" --rpc-url "$chain")"
done
```

### 6. Record the deployments

```bash
pnpm turbo run build --filter=@fairdrops/shared
pnpm --filter @fairdrops/contracts deployments:export
```

This writes `packages/contracts/deployments/<chainId>.json` for every broadcast and regenerates
`packages/contracts/ts/generated/deployments.ts`. Each record holds the address, transaction
hash, deployment block (where indexers start), deployer, salt, ABI hash and timestamp.

### 7. Verify the source (optional)

Verification publishes the contract source on the explorer. Encode the constructor arguments
from the same `.env`:

```bash
cd packages/contracts
set -a && . ./.env && set +a
ARGS=$(cast abi-encode \
  "constructor((address,uint48,address,uint16,uint32,uint8,address[],address[],address[]))" \
  "(${FAIRDROPS_ADMIN},${FAIRDROPS_ADMIN_DELAY:-172800},${FAIRDROPS_FEE_RECIPIENT:-$FAIRDROPS_ADMIN},${FAIRDROPS_FEE_BPS:-100},${FAIRDROPS_CLAIM_WINDOW:-2592000},${FAIRDROPS_VERIFIER_THRESHOLD:-1},[${FAIRDROPS_VERIFIERS}],[${FAIRDROPS_OPERATORS}],[${FAIRDROPS_PAUSERS:-}])")
```

Check that the arguments reproduce the deployed address before submitting anything:

```bash
cast create2 --deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  --salt "${FAIRDROPS_SALT:-$(cast keccak fairdrops.v1)}" \
  --init-code "$(jq -r .bytecode.object out/FairDrops.sol/FairDrops.json)${ARGS#0x}"
```

Then verify on each chain:

```bash
# Sepolia and Base Sepolia, through the Etherscan V2 API (needs ETHERSCAN_API_KEY)
forge verify-contract "$ADDRESS" src/FairDrops.sol:FairDrops --chain sepolia \
  --verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY" --constructor-args "$ARGS" --watch
forge verify-contract "$ADDRESS" src/FairDrops.sol:FairDrops --chain base-sepolia \
  --verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY" --constructor-args "$ARGS" --watch

# Monad Testnet, through Sourcify
forge verify-contract "$ADDRESS" src/FairDrops.sol:FairDrops --chain 10143 \
  --verifier sourcify --constructor-args "$ARGS" --watch

# Polkadot Hub TestNet, through Blockscout (no key needed)
forge verify-contract "$ADDRESS" src/FairDrops.sol:FairDrops --chain 420420417 \
  --verifier blockscout --verifier-url https://blockscout-testnet.polkadot.io/api/ \
  --constructor-args "$ARGS" --watch
```

### 8. Check the API and commit

```bash
cp -n .env.example .env
pnpm --filter @fairdrops/api build && pnpm --filter @fairdrops/api start
curl -s localhost:3001/contracts/testnet | jq '.contracts[] | {chain: .chain.key, address, blockNumber, abiCurrent}'
```

Every chain should appear with `abiCurrent: true`. Then commit the records:

```bash
git add packages/contracts/deployments packages/contracts/broadcast packages/contracts/ts/generated
git commit -m "Deploy FairDrops to testnet"
```

`broadcast/` holds the signed transactions and receipts, which are the audit trail of the
deployment. It contains no secrets.

## Mainnet

The commands are the same as for testnet. The differences are in how the roles are held and
what you check first.

1. **Add the chains** to `packages/shared/src/chains.ts` with `environment: "mainnet"`, and an
   RPC alias for each in `packages/contracts/foundry.toml`. Use a private RPC endpoint.
2. **Hold roles properly:**
   - `FAIRDROPS_ADMIN` is a multisig, ideally behind a timelock. It must exist at the same address
     on every chain, or the contract addresses will differ.
   - `FAIRDROPS_VERIFIERS` are separate KMS-held keys, with `FAIRDROPS_VERIFIER_THRESHOLD`
     of at least 2.
   - `FAIRDROPS_OPERATORS` is the game runtime key; `FAIRDROPS_PAUSERS` an on-call key.
   - The deployer is a fresh key used only for this and emptied afterwards.
3. **Freeze the code.** Deploy from a tagged commit with the CI profile green:

   ```bash
   FOUNDRY_PROFILE=ci pnpm --filter @fairdrops/contracts test
   ```

4. **Rehearse** the exact `.env` on a fork before spending real gas:

   ```bash
   anvil --fork-url <mainnet-rpc> --port 8546
   cd packages/contracts && forge script script/Deploy.s.sol --broadcast --rpc-url http://127.0.0.1:8546
   ```

5. Run steps 2 to 8 of the testnet flow with the mainnet chain aliases, verifying every chain.
6. Serve it with `DEPLOYMENT_ENVIRONMENT=mainnet` on the production API.

## Adding a chain

1. Confirm the chain supports Cancun opcodes and has the deterministic deployer:

   ```bash
   RPC=<rpc-url>
   cast code 0x4e59b44847b379578588920cA78FbF26c0B4956C --rpc-url "$RPC"   # must not be 0x
   cast call --create 0x6020600060005e00 --rpc-url "$RPC"                   # MCOPY; must return 0x
   ```

2. Add the chain to `packages/shared/src/chains.ts` and an alias to the `[rpc_endpoints]` table in
   `packages/contracts/foundry.toml`.
3. Deploy with the same `.env` as the rest of its environment, then run steps 4 to 8.

## Troubleshooting

| Symptom                                                                               | Cause and fix                                                                                                           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `vm.envAddress: environment variable "FAIRDROPS_..." not found`                       | A required variable is missing from `packages/contracts/.env`                                                           |
| Forge waits for a receipt that never arrives; the nonce moved on but there is no code | Another transaction took the nonce. Stop forge and re-run the deploy command                                            |
| `unexpected deployment address`                                                       | The configuration or bytecode differs from what you predicted. Compare `.env`, the salt and the commit                  |
| A chain shows a different address from the others                                     | It was deployed with a different configuration or commit. Pick one and redeploy the rest with a new salt                |
| `deployments:export` fails with "not in the registry"                                 | Add the chain to `packages/shared/src/chains.ts`                                                                        |
| `deployments:export` fails with "No receipt"                                          | The broadcast was interrupted. Re-run the deploy command; it resumes or reports the existing deployment                 |
| API shows `abiCurrent: false`                                                         | The contract changed after that deployment. Deploy the new version with a new `FAIRDROPS_SALT`, or accept the older ABI |
