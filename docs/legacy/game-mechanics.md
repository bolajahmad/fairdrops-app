# Game Mechanics

Wandash games are built around **fast rounds of skill-based mini-games**. Each giveaway runs a series of rounds — top performers win a share of the prize pool per round — until all prizes are distributed.

---

## Game Lifecycle

Every giveaway follows this state machine:

```
UPCOMING  →  ACTIVE  →  COOLDOWN  →  ACTIVE  →  ...  →  COMPLETED
 (lobby)    (round N)   (15s break)  (round N+1)        (finalize)
```

### States

| State | What's Happening |
|-------|-----------------|
| **Upcoming** | Game exists, countdown to `startTime`. Players can join the lobby. |
| **Active** | A round is in progress. Players are playing a mini-game. |
| **Cooldown** | 15-second break between rounds. Shows next game type preview. |
| **Completed** | All prizes distributed. Winners finalized on-chain. |
| **Cancelled** | Host cancelled before start. Funds refunded. |

### Transitions

1. **Upcoming → Active**: Server's scheduler detects `startTime` has passed. Broadcasts `GAME_STARTED` + `ROUND_START` to all connected players.
2. **Active → Cooldown**: Round timer expires. Server computes winners, records results, enters 15s cooldown.
3. **Cooldown → Active**: Cooldown timer expires. Next mini-game type is selected, new round starts.
4. **Active → Completed**: Enough unique winners found OR prize pool exhausted. Server submits `finalizeWinners()` on-chain.

---

## Round Engine

The round engine (`server/src/modules/rounds/round-engine.ts`) orchestrates everything:

1. **Pick game type** from the allowed games rotation
2. **Initialize** the handler's in-memory state (questions, timers, etc.)
3. **Broadcast** `ROUND_START` with config to all players
4. **Accept actions** (answers, taps, dice rolls) during the round window
5. **Timer expires** → compute winners via the handler
6. **Record results** in PostgreSQL (`round_results` table)
7. **Distribute prizes** — each round winner gets `totalRewards / numWinners`
8. **Decide next step**: more rounds needed? → cooldown. Done? → complete.

### Game Type Rotation

When a host creates a giveaway, they choose a **game style** (Quick Fire, Skill Test, Pure Luck). Each style maps to a set of mini-games:

| Game Style | Mini-Games |
|-----------|-----------|
| **Quick Fire** | Tap When Green, Tap Tap Tap |
| **Skill Test** | Quiz |
| **Pure Luck** | Dice Roll |

The round engine **shuffles** the allowed games and **rotates** through them. Once all types have been played, it reshuffles. This keeps games varied and unpredictable.

---

## Mini-Games

Each mini-game implements the `MiniGameHandler` interface:

```typescript
interface MiniGameHandler {
  getConfig(gameId): RoundConfig           // Setup round, return config for clients
  handleAction(gameId, wallet, action, payload)  // Process player input
  computeWinners(gameId): RoundWinnerResult       // Score and pick winners
  cleanup(gameId): void                            // Free memory
  peekConfig?(gameId): RoundConfig | null          // For late joiners
}
```

### Quiz (Skill Test)

**How it works:**
- Server picks 5 random questions from a question bank (football, crypto, space, music, other categories)
- Questions are sent to clients **without** the correct answer
- Players have `timePerQuestion` seconds (10s) per question
- Players submit answers via WebSocket (`ANSWER` action)
- Server validates: correct? already answered? invalid index?

**Scoring:**
- Each correct answer = 1 point
- At round end, players are ranked by correct count
- **Top 2** players win the round

**Config sent to clients:**
```json
{
  "gameType": "quiz",
  "questions": [
    { "index": 0, "question": "...", "options": ["A", "B", "C", "D"] }
  ],
  "questionCount": 5,
  "timePerQuestion": 10,
  "roundDuration": 55
}
```

### Tap When Green (Reaction Time)

**How it works:**
- Server sends `ROUND_START` with a random delay (2-5 seconds)
- After the delay, server broadcasts `GO_SIGNAL` with `sentAt` timestamp
- Players tap as fast as possible after seeing the green signal
- Tapping before `GO_SIGNAL` = "too early" (no score)
- Reaction time = `tapTimestamp - goSignalSentAt`

**Scoring:**
- Ranked by fastest reaction time
- **Top 2** fastest players win the round

**Anti-cheat:**
- `GO_SIGNAL` timestamp is set server-side
- "Too early" taps are recorded but don't count
- Duplicate taps are rejected

### Tap Tap Tap (Speed Tapping)

**How it works:**
- 10-second tapping window
- Players spam-tap as fast as possible
- Server counts taps per player
- Tap acknowledgements sent every 10 taps (to avoid flooding)

**Scoring:**
- Ranked by total tap count
- **Top 1** player wins the round

### Dice Roll (Luck)

**How it works:**
- Each player gets 3 rolls of 2 dice
- Players choose when to roll (strategy: roll all 3, or stop early)
- Each roll adds to cumulative total

**Scoring:**
- Ranked by highest cumulative total
- Tiebreak: fewer rolls used = better
- **Top 1** player wins the round

**Config sent to clients:**
```json
{
  "gameType": "dice_roll",
  "maxRolls": 3,
  "diceCount": 2,
  "roundDuration": 30
}
```

---

## Prize Distribution

### Per-Round Awards

Each round awards `totalRewards / numWinners` to each round winner.

```
Prize per winner = totalRewards / numWinners
```

If a round has 2 winners (quiz, reaction), each winner gets one share. The same player can win multiple rounds, accumulating prizes.

### Completion Conditions

The game ends when **either**:

1. **Enough unique winners** have been found (≥ `numWinners` distinct addresses)
2. **Prize pool exhausted** — remaining funds can't cover another winner share

### Final Payout Aggregation

When the game completes, the server **aggregates** all winnings per address across all rounds:

```
Player A: Won Round 1 (1 share) + Round 3 (1 share) = 2 shares
Player B: Won Round 2 (1 share) = 1 share
```

This aggregated list is signed and submitted on-chain as a single `finalizeWinners()` transaction.

---

## Lobby System

Before a game starts, players join a **lobby**:

- **In-memory**: The `LobbyManager` keeps player state in a `Map` for ultra-fast reads
- **Database**: Player join is also persisted via `PlayerGame` records (survives restarts)
- **WebSocket**: Other players in the room get `PLAYER_JOINED` / `PLAYER_LEFT` broadcasts
- **Count**: Online player count is tracked and broadcast in real-time

---

## Crash Recovery

If the server restarts mid-game:

1. **Active games**: Round timer was lost → server immediately ends the stale round (with whatever data was collected)
2. **Cooldown games**: If cooldown expired → starts next round. If still in cooldown → schedules timer for remaining duration.
3. **Completed but unfinalized**: Retries `finalizeWinners()` on-chain submission.
4. **Late joiners**: `peekConfig()` lets players who join mid-round receive the current round config without resetting state.

---

## Adding New Mini-Games

To add a new game type:

1. Add the type to `MiniGameType` enum in `schema.prisma`
2. Create a handler file in `server/src/modules/rounds/games/`
3. Implement the `MiniGameHandler` interface
4. Register it in the `handlers` map in `round-engine.ts`
5. Map it to a game style in `game.service.ts` → `resolveAllowedGames()`
6. Build the frontend UI component for the new game type

The handler interface makes this straightforward — the round engine handles all the lifecycle, timer, and broadcast logic.
