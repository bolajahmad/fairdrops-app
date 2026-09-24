# Smart Contracts

Wandash's on-chain layer is a single **GiveawayV1** contract deployed on **Monad Testnet**. It handles prize escrow, host profiles, and winner finalization — all the trust-critical operations that need to be verifiable.

---

## Deployment

| Parameter | Value |
|-----------|-------|
| **Contract** | GiveawayV1 |
| **Address** | `0x575dca87061898C3EbBC2a8F2a49C09120E88951` |
| **Chain** | Monad Testnet (Chain ID: 10143) |
| **Start Block** | 24551060 |
| **Framework** | Hardhat + Hardhat Ignition |

---

## Contract Overview

GiveawayV1 is an EVM contract that:

1. **Escrows tokens** when a host creates a giveaway (native MON or any ERC-20)
2. **Takes a platform fee** (1% by default, configurable up to 5%)
3. **Stores host profiles** as hex-encoded metadata on-chain
4. **Verifies and distributes prizes** via ECDSA-signed winner lists

### Inheritance

```
GiveawayV1
├── Ownable          (access control — fee settings, role management)
├── ReentrancyGuard  (reentrancy protection on all fund transfers)
└── SafeERC20        (safe token interaction patterns)
```

---

## Data Structures

### Giveaway

```solidity
struct Giveaway {
    address host;         // Creator's wallet
    address token;        // Prize token (address(0) = native MON)
    uint256 prize;        // Total prize pool (after fee)
    uint64  startTime;    // Unix timestamp when game begins
    uint8   winners;      // Number of winners to pick
    uint8   status;       // 0=pending, 1=active, 2=completed, 3=cancelled
    bytes32 metadata;     // Hex-encoded JSON (title, description, game style)
}
```

### Host

```solidity
struct Host {
    bytes32 metadata;     // Hex-encoded profile (username, avatar, social links, bio)
}
```

---

## Functions

### `createGiveaway(token, amount, numWinners, startTime, metadata)`

Creates a new giveaway and locks the prize tokens.

- **Token handling**: If `token` is `address(0)`, accepts native MON via `msg.value`. Otherwise, does `safeTransferFrom` for ERC-20 tokens.
- **Fee**: Takes 1% (100 bps) upfront. The remaining 99% is the prize pool.
- **Generates** a unique `bytes32` giveaway ID
- **Emits** `GiveawayCreated(id, host, token, amount, metadata, timestamp)`

### `addFunds(giveawayId)`

Host can add more tokens to an existing giveaway before it starts.

- Only callable by the original host
- Only before `startTime`

### `cancelGiveaway(giveawayId)`

Cancels a giveaway and refunds the full prize pool to the host.

- Only callable by the host
- Only before the game has started
- Sets status to `cancelled`

### `finalizeWinners(giveawayId, winners[], amounts[], signature)`

The critical payout function. Distributes prizes to winners.

- **Signature verification**: Reconstructs the payout hash from `(giveawayId, winners, amounts)`, then verifies the ECDSA signature was produced by the designated `VERIFIER_ROLE` address
- **Distribution**: Transfers `amounts[i]` to each `winners[i]`
- **Status update**: Sets giveaway status to `completed`
- **Emits** `WinnersFinalized(id)`

```
Verification flow:
1. hash = keccak256(abi.encode(giveawayId, winners, amounts))
2. signer = ecrecover(hash, signature)
3. require(signer == VERIFIER_ROLE)
4. for each winner: transfer amount
```

### `updateHostProfile(metadata)`

Stores a hex-encoded JSON blob as the host's on-chain profile. This includes display name, avatar, social links, and bio.

- **Emits** `HostProfileUpdated(host, metadata)`

### `setFeeBps(newFee)` (Owner only)

Updates the platform fee percentage. Capped at 500 bps (5%).

### `setFeeRecipient(newRecipient)` (Owner only)

Changes where platform fees are sent.

---

## Events

| Event | Description |
|-------|-------------|
| `GiveawayCreated(id, host, token, amount, metadata, timestamp)` | New giveaway created and funded |
| `HostProfileUpdated(host, metadata)` | Host updated their profile |
| `WinnersFinalized(id)` | Winners paid out, game completed |
| `FeeTaken(id, amount)` | Platform fee collected |
| `ResultCommitted(id, resultHash)` | Game result hash stored |

---

## Security

### Reentrancy Protection
All functions that move funds use OpenZeppelin's `nonReentrant` modifier. This prevents the classic reentrancy attack where a malicious token contract calls back into the giveaway contract during a transfer.

### Safe Token Transfers
ERC-20 interactions use `SafeERC20` wrappers (`safeTransfer`, `safeTransferFrom`) that handle tokens with non-standard return values.

### Signature Verification
Winner finalization requires an ECDSA signature from the verifier. This means:
- The server computes winners but cannot pay out to arbitrary addresses
- The verifier key signs the exact winner list and amounts
- The contract independently verifies the signature before distributing
- Anyone can verify that a given payout was authorized

### Access Control
- **Owner**: Can update fee settings, set the verifier role
- **Verifier**: Can authorize winner distributions (signature checked on-chain)
- **Host**: Can cancel their own giveaway (before start), add funds
- **Anyone**: Can read giveaway data, verify past results

---

## Token Support

| Token | Type | How It Works |
|-------|------|-------------|
| **MON** | Native | Sent via `msg.value` on `createGiveaway()` |
| **USDT** | ERC-20 | Requires `approve()` first, then `safeTransferFrom` |
| **USDC** | ERC-20 | Same as USDT |
| **Any ERC-20** | ERC-20 | Contract is token-agnostic — any standard ERC-20 works |

---

## Indexing (Goldsky Subgraph)

The contract's events are indexed by a Goldsky-hosted subgraph, configured in `subgraph/giveaway-subgraph.json`:

```json
{
  "name": "giveaway",
  "version": "1.0.0",
  "chains": ["monad-testnet"],
  "instances": [{
    "contract": "GiveawayV1",
    "address": "0x575dca87061898C3EbBC2a8F2a49C09120E88951",
    "startBlock": 24551060
  }]
}
```

The subgraph provides GraphQL queries used by both the frontend (browse giveaways, host profiles) and the server (detect new giveaways to create game sessions).
