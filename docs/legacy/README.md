# Wandash — Play Games. Win MON. Have Fun.

**Wandash** is a real-time, gamified giveaway platform built on **Monad**. Hosts create prize pools, players compete in fast-paced mini-games, and winners get paid — all on-chain.

Think of it as the collision of live game shows and crypto giveaways: a host puts up MON (or ERC-20 tokens), players jump in, play quick skill-based rounds, and the best players walk away with real rewards.

**Deployment Link**: [Wandash Page](https://wandash-monadblitzlagos.vercel.app/)

---

## Why Wandash?

Monad is fast. Transactions settle in seconds. Gas is cheap. That makes it the perfect chain for real-time, interactive experiences that would be impossible on slower networks.

Wandash uses this speed to create a **live multIGamePlayer gaming experience** where:

- **Players earn MON** by competing in mini-games (quiz, reaction, tap challenges, dice)
- **Hosts drive engagement** by creating giveaways that attract real users
- **Every result is verifiable** — game outcomes are committed on-chain with cryptographic signatures
- **Onboarding is frictionless** — players sign in with email or phone via Web3Auth (no wallet setup required)

The result: more users on Monad, more on-chain activity, more fun.

---

## How It Works

### For Players

1. **Browse** live and upcoming games on the homepage
2. **Join** a game — sign in with email/phone (Web3Auth creates a wallet for you)
3. **Play** real-time mini-games in your browser (quiz rounds, tap challenges, etc.)
4. **Win** — top performers each round earn a share of the prize pool
5. **Get paid** — winnings are finalized on-chain and sent to your wallet

### For Hosts

1. **Connect wallet** (MetaMask or any injected wallet)
2. **Create a giveaway** — choose prize token, amount, number of winners, game style
3. **Fund it** — tokens are locked in the smart contract (1% platform fee)
4. **Watch it happen** — the game runs automatically, winners are determined by skill
5. **Results finalize on-chain** — transparent, verifiable, trustless

---

## The Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Blockchain** | Monad (EVM-compatible) | On-chain giveaway creation, prize custody, winner finalization |
| **Smart Contracts** | Solidity (GiveawayV1) | Prize escrow, ECDSA-verified payouts, host profiles |
| **Indexer** | Goldsky Subgraph | Real-time indexing of contract events |
| **Backend** | Node.js + Express + WebSocket | Real-time game engine, round management, player coordination |
| **Database** | PostgreSQL + Prisma | Game state, player records, round results |
| **Frontend** | Next.js 15 + Tailwind + Zustand | Responsive game UI, live updates |
| **Auth** | Web3Auth (players) / MetaMask (hosts) | Frictionless player onboarding, native wallet for hosts |
| **Deployment** | Render (server + DB) / Vercel (frontend) | Free-tier production hosting |

---

## Project Structure

```
wandash/
├── frontend/          # Next.js app — player & host UIs, game screens
├── server/            # Express + WebSocket — real-time game engine
├── contracts/         # Solidity smart contracts (Hardhat)
├── subgraph/          # Goldsky subgraph config for event indexing
├── docs/              # This documentation
└── render.yaml        # One-click Render deployment blueprint
```

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System design, data flow, how all the pieces connect |
| [Smart Contracts](./smart-contracts.md) | GiveawayV1 contract — functions, security, on-chain logic |
| [Game Mechanics](./game-mechanics.md) | Mini-games, round engine, scoring, winner selection |
| [API & WebSocket](./api-websocket.md) | REST endpoints, WebSocket protocol, message types |
| [Roadmap](./roadmap.md) | Cross-chain vision, ZK proofs, future game types |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL)
- A Monad testnet wallet with MON (for hosting giveaways)

### Local Development

```bash
# 1. Start the database
cd server
docker compose up -d

# 2. Set up the server
cp .env.example .env   # edit with your values
npm install
npx prisma db push
npm run dev             # runs on :3001

# 3. Start the frontend
cd ../frontend
npm install
npm run dev             # runs on :3000
```

### Deploy to Production

The project includes a [render.yaml](../render.yaml) blueprint for one-click deployment on Render (free tier):

```bash
# Push to GitHub, then on Render:
# 1. New → Blueprint → connect your repo
# 2. Set secret env vars: SIGNER_PRIVATE_KEY, CORS_ORIGIN
# 3. Deploy
```

Frontend deploys to Vercel with zero config.

---

## Core Concepts

### On-Chain Prize Custody

When a host creates a giveaway, tokens are transferred to the smart contract and locked. The contract holds the funds until the game completes and winners are finalized. No one — not even the platform — can access the funds outside of the defined rules.

### Verifiable Game Results

Game outcomes follow a **commit-reveal pattern**:

1. The game server runs rounds, computes winners based on player performance
2. Winners and prize amounts are **signed by a designated verifier** using ECDSA
3. The signed result is submitted on-chain via `finalizeWinners()`
4. The smart contract **verifies the signature** before distributing prizes

This means every payout is cryptographically verifiable. Anyone can check that the stated winners actually won, and that the verifier authorized the distribution.

### Frictionless Player Onboarding

Players don't need MetaMask or any crypto knowledge. Web3Auth provides **email/phone login** that creates a wallet behind the scenes. Players just play the game — the blockchain is invisible infrastructure.

Hosts, who need full wallet control, connect with MetaMask or any standard wallet.

---

## License

MIT
