# Architecture

Wandash is a three-tier system: a **Next.js frontend**, a **Node.js real-time backend**, and **Solidity smart contracts on Monad** — glued together by a Goldsky subgraph that indexes on-chain events.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│               Next.js 15 + Tailwind + Zustand               │
│                                                             │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌──────────┐ │
│  │ Homepage  │  │ Game Page │  │ Host      │  │ Organize │ │
│  │ (Browse)  │  │ (Play)    │  │ Profile   │  │ (Create) │ │
│  └────┬─────┘  └─────┬─────┘  └─────┬─────┘  └────┬─────┘ │
│       │              │              │              │        │
│  ┌────▼──────────────▼──────────────▼──────────────▼─────┐  │
│  │  API Routes (/api/giveaways, /api/hosts)              │  │
│  │  WebSocket Client (join, answer, tap)                 │  │
│  │  Wagmi / Web3Auth (wallet + tx signing)               │  │
│  └───────┬──────────────┬──────────────┬─────────────────┘  │
└──────────┼──────────────┼──────────────┼────────────────────┘
           │              │              │
     ┌─────▼─────┐  ┌────▼────┐  ┌──────▼──────┐
     │ Subgraph  │  │ Server  │  │   Monad     │
     │ (Goldsky) │  │ (WS+REST│  │  Blockchain │
     │           │  │  Game   │  │             │
     └─────┬─────┘  │ Engine) │  └──────┬──────┘
           │        └────┬────┘         │
           │             │              │
     ┌─────▼─────────────▼──────────────▼─────┐
     │           MONAD TESTNET                 │
     │    GiveawayV1 Smart Contract            │
     │  (Prize escrow + winner finalization)   │
     └─────────────────────────────────────────┘
```

---

## Data Flow

### 1. Giveaway Creation (Host → Chain → Subgraph → Server)

```
Host fills form → Wagmi sends createGiveaway() tx → Monad contract
                                                          │
                                                  emits GiveawayCreated
                                                          │
                                                  Goldsky subgraph indexes
                                                          │
                                            Server polls subgraph (every 10s)
                                                          │
                                              Creates "upcoming" Game in DB
```

1. Host connects MetaMask, fills the giveaway form (title, token, prize, winners, game style)
2. Frontend calls `createGiveaway()` on the GiveawayV1 contract via Wagmi
3. Contract locks tokens, takes 1% fee, emits `GiveawayCreated` event
4. Goldsky subgraph indexes the event within seconds
5. Server's **subgraph poller** (cron every 10s) detects the new giveaway
6. Server reads on-chain struct for `startTime` and `numWinners`
7. Server creates an `upcoming` Game record in PostgreSQL

### 2. Game Lifecycle (Server Orchestrated)

```
                    startTime passes
                          │
  ┌───────────┐    ┌──────▼──────┐    ┌─────────────┐    ┌───────────┐
  │  UPCOMING  │───▶│   ACTIVE    │───▶│  COOLDOWN    │───▶│ COMPLETED │
  │  (lobby)   │    │  (playing)  │    │  (15s break) │    │ (finalize)│
  └───────────┘    └──────┬──────┘    └──────┬───────┘    └───────────┘
                          │                  │
                    Round Engine        Next round?
                    • Send questions    • Yes → ACTIVE
                    • Collect answers   • No (enough winners) → COMPLETED
                    • Score players
                    • Pick winners
```

### 3. Real-Time Gameplay (Player ↔ Server via WebSocket)

```
Player                          Server                        All Players
  │                               │                               │
  ├── JOIN_GAME ─────────────────▶│                               │
  │◀── JOINED_GAME (game state) ─┤── PLAYER_JOINED ─────────────▶│
  │                               │                               │
  │  (startTime passes)           │                               │
  │◀────────────────── GAME_STARTED / ROUND_START ───────────────▶│
  │  (questions + config)         │                               │
  │                               │                               │
  ├── ANSWER (questionIndex, ans)▶│                               │
  │◀── ANSWER_RESULT (correct?) ──┤                               │
  │                               │                               │
  │  (round timer expires)        │                               │
  │◀──────────────────── ROUND_END (winners, prizes) ───────────▶│
  │◀──────────────── COOLDOWN_START (nextGame, duration) ────────▶│
  │                               │                               │
  │  (repeat rounds...)           │                               │
  │                               │                               │
  │◀──────────────── GAME_END (final winners + payouts) ─────────▶│
```

### 4. Winner Finalization (Server → Chain)

```
Game completes → Server aggregates per-address payouts
                          │
                 Server signs (giveawayId, winners[], amounts[])
                          │
                 Calls finalizeWinners() on contract
                          │
                 Contract verifies ECDSA signature
                          │
                 Contract transfers tokens to each winner
                          │
                 Emits WinnersFinalized event
```

---

## Component Details

### Frontend (Next.js 15)

```
frontend/
├── app/
│   ├── (home)/           # Player-facing: browse games, join
│   ├── (host)/           # Host-facing: create giveaways, manage profile
│   ├── games/[id]/       # Live game screen (quiz UI, lobby, results)
│   └── api/              # Next.js API routes (proxy to subgraph + server)
├── hooks/
│   ├── use-game-socket   # WebSocket connection + message handling
│   └── use-wallet-balances # Token balance fetching
├── store/
│   ├── game-store        # Zustand: game phase, round, config, winners
│   ├── user-store        # Persisted user role (player/host)
│   └── ui-store          # Loading states, modals
└── lib/
    ├── context/          # Web3Auth provider (players), Wagmi provider (hosts)
    ├── contracts/        # GiveawayV1 ABI
    ├── queries/          # GraphQL client for subgraph
    ├── websocket/        # Socket connection + action senders
    └── schemas/          # Zod validation for forms
```

**Key design decisions:**
- **Dual auth**: Players use Web3Auth (email/phone → embedded wallet), hosts use MetaMask. This lets casual users play without crypto setup while hosts maintain full wallet control.
- **API routes as proxy**: Frontend API routes fetch from the subgraph and merge with server data. This avoids exposing the subgraph URL to clients and lets us combine on-chain + off-chain data in one response.
- **Zustand over Context**: Game state changes rapidly during live play. Zustand gives selective re-rendering without the overhead of React Context.

### Server (Express + WebSocket)

```
server/src/
├── config/env            # Environment variables
├── lib/
│   ├── prisma            # Database client (PrismaClient + pg adapter)
│   ├── logger            # Structured logging with module tags
│   ├── events            # EventEmitter for internal pub/sub
│   └── error-handler     # Express error middleware
├── modules/
│   ├── games/            # REST API: CRUD, join, player management
│   ├── indexer/          # Subgraph poller: detects new on-chain giveaways
│   ├── lobby/            # In-memory lobby state for fast player tracking
│   └── rounds/           # Round engine: game logic, timers, scoring
│       └── games/        # Mini-game handlers (quiz, dice, reaction, tap)
├── websocket/
│   ├── handlers          # Message routing: JOIN, LEAVE, ANSWER, TAP, etc.
│   ├── connection-map    # WS→player mapping, room broadcasting
│   └── messages          # Shared message type enum
├── workers/
│   └── game-scheduler    # Cron: poll subgraph, start ready games
└── chain/
    ├── client            # Viem: read contract, submit finalizeWinners tx
    ├── abi               # GiveawayV1 ABI
    └── chain             # Monad chain definition
```

**Key design decisions:**
- **In-memory game state**: Round state (quiz answers, tap counts, reaction times) is kept in memory for speed. Only final results are persisted to PostgreSQL.
- **Game handler interface**: Each mini-game (quiz, dice, reaction, tap-tap) implements a common `MiniGameHandler` interface. Adding new games means implementing one interface.
- **Crash recovery**: On restart, the server queries for `active`/`cooldown` games and resumes them — ending stale rounds or scheduling pending cooldowns.
- **Subgraph as source of truth**: The server doesn't create games from user input — it only creates games when it sees `GiveawayCreated` events indexed by the subgraph. This ensures every game has a corresponding on-chain escrow.

### Smart Contract (GiveawayV1)

Deployed on Monad Testnet at `0x575dca87061898C3EbBC2a8F2a49C09120E88951`.

See [Smart Contracts](./smart-contracts.md) for full details.

### Subgraph (Goldsky)

Indexes GiveawayV1 events:
- `GiveawayCreated` — new giveaway with metadata
- `HostProfileUpdated` — host profile changes
- `WinnersFinalized` — game completion with winner list
- `FeeTaken` — platform fee records

The subgraph powers the frontend's browse pages and the server's game detection. Hosted on Goldsky's managed infrastructure — no maintenance needed.

---

## Database Schema

```
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│    games     │        │   players    │        │ round_results│
├──────────────┤        ├──────────────┤        ├──────────────┤
│ id           │        │ id           │        │ id           │
│ giveaway_id  │◀───┐   │ wallet_addr  │        │ game_id      │
│ host_address │    │   │ display_name │        │ round_number │
│ status       │    │   │ created_at   │        │ game_type    │
│ total_rewards│    │   └──────┬───────┘        │ winner_addrs │
│ num_winners  │    │          │                │ prize_per_win│
│ current_round│    │   ┌──────▼───────┐        │ completed_at │
│ allowed_games│    │   │ player_games │        └──────────────┘
│ winners[]    │    │   ├──────────────┤
│ result_hash  │    └───│ game_id      │
│ start_time   │        │ player_id    │
│ ...          │        │ status       │
└──────────────┘        │ eliminated   │
                        │ placement    │
                        │ prize        │
                        └──────────────┘
```

---

## Security Model

1. **Prize custody**: Tokens are locked in the smart contract at creation time. The contract — not the server — holds the funds.
2. **Signature verification**: `finalizeWinners()` requires a valid ECDSA signature from the designated verifier. The contract checks `ecrecover` before distributing any tokens.
3. **Access control**: Only the verifier role can authorize payouts. Only the host can cancel (before start time). Only the owner can update fee settings.
4. **Reentrancy protection**: All fund-moving functions use OpenZeppelin's `ReentrancyGuard`.
5. **Server as game engine, not custodian**: The server runs game logic and computes winners, but it cannot steal funds — it can only submit signed results that the contract must verify.
