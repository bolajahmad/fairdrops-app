# Roadmap

Wandash is built as a **Monad-first** platform — all core game logic, prize custody, and winner verification happen on Monad. This roadmap outlines the path from current state to a fully verifiable, cross-chain gaming platform.

---

## Current State (v1)

### What's Live

- **GiveawayV1 smart contract** on Monad Testnet — prize escrow, ECDSA-verified winner finalization
- **4 mini-games**: Quiz, Tap When Green (reaction), Tap Tap Tap (speed), Dice Roll (luck)
- **Real-time multIGamePlayer** via WebSocket — hundreds of concurrent players per game
- **Frictionless onboarding** — email/phone login via Web3Auth (no wallet required for players)
- **Host tools** — create giveaways, set prize pools, choose game styles, manage profile
- **Automated game lifecycle** — subgraph detection → lobby → rounds → cooldown → finalization
- **Multi-token support** — native MON + any ERC-20 (USDT, USDC)
- **Subgraph indexing** — real-time event indexing via Goldsky

### Trust Model (v1)

The current system uses a **trusted verifier** model:

1. The game server runs rounds and computes winners based on player actions
2. A server-side verifier key signs `(giveawayId, winners[], amounts[])`
3. The smart contract checks the ECDSA signature before distributing funds
4. Anyone can verify the signature matches the stated winners

This is already more transparent than traditional giveaways — results are on-chain and cryptographically signed — but the verifier is a single trusted party.

---

## Phase 2: Verifiable Game Commitments

**Goal**: Make game fairness provable, not just claimed.

### Commit-Reveal for Game Parameters

Before each round, the server will **commit** to game parameters on-chain:

```
Round Start:
  commitment = keccak256(questions, correctAnswers, salt)
  → stored on-chain before round begins

Round End:
  reveal(questions, correctAnswers, salt)
  → anyone can verify commitment matches revealed data
```

This proves the server didn't change questions or answers after seeing player responses.

### Result Hash Commitments

After each round:
- Server publishes `resultHash = keccak256(roundNumber, scores[], winners[])` on-chain
- Full round data available off-chain for anyone to reconstruct and verify
- Immutable audit trail of every round outcome

### Merkle Proof Winner Verification

Instead of a flat winner list, use a **Merkle tree** of all player scores:
- Root published on-chain after each round
- Any player can submit a Merkle proof to verify their score was included
- Disputes resolved by proof verification — no trust required

---

## Phase 3: ZK Game Proofs

**Goal**: Fully trustless game execution with zero-knowledge proofs.

### ZK-Verified Scoring

Use ZK circuits (via SP1, Risc0, or Noir) to prove game outcomes without revealing inputs:

```
Public inputs:  roundNumber, winnerAddresses[], scores[]
Private inputs: allPlayerActions[], serverSeed, timestamps[]

ZK Proof proves:
  1. Scores were correctly computed from player actions
  2. Winners are the top-scoring players
  3. No player data was modified after submission
  4. Server randomness (seed) was committed before round start
```

The smart contract verifies the ZK proof on-chain before distributing prizes. No trusted verifier needed.

### Anti-Cheat Guarantees

ZK proofs can also enforce:
- **Timing fairness**: Prove reaction times were measured correctly relative to the GO signal
- **Question integrity**: Prove questions were selected from a committed question bank
- **No selective dropping**: Prove all received player actions were included in scoring

### Implementation Path

1. Start with **SP1** (Succinct) — Rust-based ZK VM with EVM verification
2. Game logic compiled to a ZK-provable program
3. Proof generated off-chain after each round (seconds on modern hardware)
4. Proof verified on-chain by a Solidity verifier contract
5. Monad's speed makes on-chain verification practical (low gas, fast finality)

---

## Phase 4: Cross-Chain Integration

**Goal**: Let users on any chain participate in Wandash games. Core logic stays on Monad.

### Architecture

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Ethereum │  │ Arbitrum │  │ Base     │
│ Bridge   │  │ Bridge   │  │ Bridge   │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │              │              │
     └──────────────┼──────────────┘
                    │
            ┌───────▼───────┐
            │    MONAD      │
            │  GiveawayV2   │
            │  (all logic)  │
            └───────────────┘
```

### How It Works

1. **Bridge-in**: Users on Ethereum/Arbitrum/Base bridge tokens to Monad to fund giveaways or claim prizes
2. **Play on Monad**: All game logic, round execution, and winner verification happen on Monad
3. **Bridge-out**: Winners can bridge MON or ERC-20 prizes back to their preferred chain
4. **Cross-chain messaging**: Use LayerZero or Hyperlane to relay game events to source chains

### Why Core Logic Stays on Monad

- **Speed**: Monad's parallel execution handles hundreds of game finalizations per second
- **Cost**: Sub-cent transaction costs make per-round on-chain commitments practical
- **Finality**: Fast finality means real-time game results, not "wait 12 confirmations"
- **EVM compatibility**: Same Solidity contracts, same tooling, no learning curve

### Cross-Chain Prize Pools

Future version: hosts on **any chain** can create giveaways that execute on Monad:

1. Host on Ethereum calls `createGiveaway()` on an Ethereum gateway contract
2. Gateway bridges funds + metadata to Monad's GiveawayV2
3. Game runs entirely on Monad
4. Winners finalized on Monad
5. Prizes bridged back to winners' preferred chains

---

## Phase 5: Platform Evolution

### New Game Types

| Game | Type | Description |
|------|------|-------------|
| **Word Scramble** | Skill | Unscramble letters to form words |
| **Memory Match** | Skill | Flip cards, find pairs fastest |
| **Math Blitz** | Skill | Solve arithmetic problems under time pressure |
| **Prediction Market** | Mixed | Predict outcomes of real events |
| **Battle Royale** | Elimination | Last player standing after multi-round elimination |
| **Auction** | Strategy | Bid on prizes with earned game tokens |

### Host Analytics Dashboard

- Real-time viewer count, engagement metrics
- Round-by-round participation breakdown
- Player retention across games
- Prize distribution analytics

### Player Profiles & Leaderboards

- Global leaderboard by total winnings, games played, win rate
- Achievement badges (first win, 10-game streak, speed demon)
- Player history with verifiable on-chain records

### Tournament Mode

- Multi-game tournaments spanning hours or days
- Bracket-style elimination across game types
- Accumulated scoring with final grand prize
- Spectator mode for eliminated players

### DAO Governance

- WAND token for platform governance
- Community votes on new game types, fee parameters, feature priorities
- Revenue sharing with token holders
- Question bank curation by community

---

## Monad Ecosystem Fit

Wandash is designed to be a **first-class Monad application** — the kind of interactive, high-throughput experience that only works on a fast chain:

### Driving Monad Activity

- **Every game** generates on-chain transactions: giveaway creation, fund locking, winner finalization
- **Every host** creates economic activity: token transfers, fee payments, profile updates
- **Every player** is onboarded to Monad via Web3Auth — growing the user base with zero friction
- **Subgraph indexing** drives ecosystem tooling adoption

### Why Monad Is Perfect for This

| Traditional Chain | Monad |
|------------------|-------|
| 15 TPS, 12s finality | 10,000+ TPS, sub-second finality |
| $5+ per tx → on-chain commitments impractical | Sub-cent tx → commit every round cheaply |
| Wait for confirmations → breaks real-time flow | Instant finality → seamless game experience |
| High gas → batched transactions only | Low gas → per-round on-chain verification |

Wandash showcases what's possible when blockchain infrastructure is fast enough for real-time consumer applications. It's not just a giveaway tool — it's a demonstration that **Monad enables a new category of interactive, verifiable, on-chain experiences** that users actually want to use.

---

## Timeline

| Phase | Focus | Target |
|-------|-------|--------|
| **v1** (Current) | Core platform — games, prizes, verification | Live on testnet |
| **v2** | Commit-reveal, result hash commitments, Merkle proofs | Q3 2026 |
| **v3** | ZK game proofs, trustless execution | Q4 2026 |
| **v4** | Cross-chain bridges, multi-chain prize pools | Q1 2027 |
| **v5** | Tournaments, DAO, token launch | Q2 2027 |
