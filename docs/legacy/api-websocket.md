# API & WebSocket Protocol

Wandash uses a **REST API** for data fetching and a **WebSocket** connection for real-time gameplay.

---

## REST API

Base URL: `http://localhost:3001` (dev) / your Render URL (production)

### Health Check

```
GET /health
```

Response:
```json
{ "status": "ok", "uptime": 1234.56 }
```

### List Games

```
GET /api/games?status=active&limit=50&offset=0
```

Query params:
- `status` — Filter by `upcoming`, `active`, `cooldown`, `completed`, `cancelled`
- `limit` — Max results (default 50, max 100)
- `offset` — Pagination offset

Response: Array of games with player counts.

### Get Game by ID

```
GET /api/games/:id
```

Response: Full game object with nested player data.

### Get Game by Giveaway ID

```
GET /api/games/giveaway/:giveawayId
```

Response: Game object matched by on-chain giveaway ID. `totalRewards` and `rewardsDisbursed` are formatted in human-readable units (divided by 10^18).

### Get Game Status

```
GET /api/games/:id/status
```

Response:
```json
{
  "id": "...",
  "giveawayId": "0x...",
  "status": "active",
  "playerCount": 42,
  "startTime": "2026-04-11T12:00:00.000Z",
  "currentRound": 3,
  "currentGame": "quiz",
  "nextGame": "tap_when_green",
  "cooldownEndsAt": null,
  "totalRoundsPlayed": 3
}
```

### Get Players

```
GET /api/games/:id/players
```

Response: Array of PlayerGame records with nested player info, ordered by join time.

### Join Game

```
POST /api/games/:id/join
Content-Type: application/json

{
  "walletAddress": "0x1234...abcd",
  "displayName": "alice"
}
```

Response: PlayerGame object. Idempotent — re-joining returns existing record with status set to `online`.

### Get Round Config

```
GET /api/games/:id/round-config
```

Response (when active):
```json
{
  "config": {
    "gameType": "quiz",
    "questions": [...],
    "questionCount": 5,
    "timePerQuestion": 10,
    "roundDuration": 55
  },
  "round": 2,
  "gameType": "quiz"
}
```

Response (when not active): `{ "config": null, "round": 0, "gameType": null }`

---

## Frontend API Routes

The Next.js frontend exposes its own API routes that combine subgraph + server data:

### List Giveaways

```
GET /api/giveaways?page=1&limit=20
```

Fetches from the Goldsky subgraph, filters by start time, enriches with server game data.

### Get Giveaway

```
GET /api/giveaways/:gid
```

Single giveaway by on-chain ID with merged server data.

### List Hosts

```
GET /api/hosts?page=1&limit=10
```

Aggregates host data from subgraph — total giveaways, total prize pool.

### Get Host

```
GET /api/hosts/:id
```

Host profile by wallet address.

---

## WebSocket Protocol

Connect to: `ws://localhost:3001` (dev) / `wss://your-render-url.onrender.com` (production)

All messages are JSON. Every message has a `type` field.

### Connection Flow

```
Client                              Server
  │                                    │
  ├──── WebSocket connect ────────────▶│
  │                                    │
  ├──── JOIN_GAME ────────────────────▶│
  │     { type, giveawayId,            │
  │       walletAddress, displayName } │
  │                                    │
  │◀──── JOINED_GAME ─────────────────┤  (ack + full game state)
  │                                    │
  │◀──── PLAYER_JOINED ───────────────┤  (broadcast to others)
  │                                    │
```

---

### Client → Server Messages

#### JOIN_GAME

Join a game room by giveaway ID.

```json
{
  "type": "JOIN_GAME",
  "giveawayId": "0xabc123...",
  "walletAddress": "0x1234...abcd",
  "displayName": "alice"
}
```

#### LEAVE_GAME

Leave the current game room.

```json
{
  "type": "LEAVE_GAME"
}
```

#### PLAYER_ACTION

Generic action passthrough (legacy).

```json
{
  "type": "PLAYER_ACTION",
  "action": "some_action",
  "payload": { ... }
}
```

#### ANSWER (Quiz)

Submit a quiz answer.

```json
{
  "type": "ANSWER",
  "payload": {
    "questionIndex": 2,
    "answer": 1
  }
}
```

#### TAP (Reaction / Tap-Tap)

Register a tap.

```json
{
  "type": "TAP"
}
```

#### ROLL_DICE

Roll dice in a dice game.

```json
{
  "type": "ROLL_DICE"
}
```

---

### Server → Client Messages

#### JOINED_GAME

Sent to the joining player with the full current game state.

```json
{
  "type": "JOINED_GAME",
  "gameId": "clxyz...",
  "giveawayId": "0x...",
  "status": "upcoming",
  "currentRound": 0,
  "currentGame": null,
  "nextGame": null,
  "allowedGames": ["quiz", "tap_when_green"],
  "startTime": "2026-04-11T12:00:00.000Z",
  "cooldownEndsAt": null,
  "onlineCount": 15,
  "config": null
}
```

If the game is already `active`, `config` contains the current round config so late joiners can play immediately.

#### PLAYER_JOINED

Broadcast to all others in the room.

```json
{
  "type": "PLAYER_JOINED",
  "walletAddress": "0x...",
  "displayName": "alice",
  "onlineCount": 16
}
```

#### PLAYER_LEFT

```json
{
  "type": "PLAYER_LEFT",
  "walletAddress": "0x...",
  "onlineCount": 15
}
```

#### GAME_STARTED

Sent when the game transitions from `upcoming` to `active`.

```json
{
  "type": "GAME_STARTED",
  "gameId": "clxyz...",
  "giveawayId": "0x...",
  "allowedGames": ["quiz", "tap_when_green"]
}
```

#### ROUND_START

Sent at the start of each round with game-specific config.

```json
{
  "type": "ROUND_START",
  "round": 1,
  "gameType": "quiz",
  "config": {
    "gameType": "quiz",
    "questions": [
      { "index": 0, "question": "...", "options": ["A", "B", "C", "D"] }
    ],
    "questionCount": 5,
    "timePerQuestion": 10,
    "roundDuration": 55
  }
}
```

#### ANSWER_RESULT (Quiz)

Sent to the player who submitted an answer.

```json
{
  "type": "ANSWER_RESULT",
  "questionIndex": 2,
  "correct": true,
  "correctAnswer": 1,
  "yourScore": 3
}
```

#### GO_SIGNAL (Reaction Game)

Sent after the random delay in a Tap When Green round.

```json
{
  "type": "GO_SIGNAL",
  "sentAt": 1744369200000
}
```

#### TAP_RESULT (Reaction Game)

```json
{
  "type": "TAP_RESULT",
  "reactionTime": 342,
  "tooEarly": false
}
```

#### TAP_COUNT (Tap-Tap Game)

Sent every 10 taps as an acknowledgement.

```json
{
  "type": "TAP_COUNT",
  "count": 50
}
```

#### DICE_RESULT

```json
{
  "type": "DICE_RESULT",
  "values": [4, 6],
  "rollTotal": 10,
  "rollNumber": 2,
  "total": 18,
  "rollsRemaining": 1
}
```

#### ROUND_END

Broadcast to all players when a round ends.

```json
{
  "type": "ROUND_END",
  "round": 1,
  "gameType": "quiz",
  "winners": ["0xabc...", "0xdef..."],
  "prizePerWinner": "1000000000000000000"
}
```

#### COOLDOWN_START

Broadcast between rounds.

```json
{
  "type": "COOLDOWN_START",
  "cooldownEndsAt": "2026-04-11T12:01:15.000Z",
  "nextGame": "tap_when_green",
  "cooldownDuration": 15000
}
```

#### GAME_END

Final broadcast when the game completes.

```json
{
  "type": "GAME_END",
  "gameId": "clxyz...",
  "giveawayId": "0x...",
  "winners": [
    { "address": "0xabc...", "amount": "2000000000000000000" },
    { "address": "0xdef...", "amount": "1000000000000000000" }
  ],
  "totalRounds": 5
}
```

#### ERROR

Sent when something goes wrong.

```json
{
  "type": "ERROR",
  "message": "Not in a game"
}
```

---

## Message Type Enum

All message types are defined in `server/src/websocket/messages.ts`:

```typescript
enum WsMessageType {
  // Client → Server
  JOIN_GAME, LEAVE_GAME, PLAYER_ACTION,
  ROLL_DICE, TAP, ANSWER,

  // Server → Client
  JOINED_GAME, PLAYER_JOINED, PLAYER_LEFT,
  GAME_STATE, GAME_STARTING, GAME_STARTED,
  ROUND_START, ROUND_END,
  COOLDOWN_START, STATE_UPDATE,
  PLAYER_ELIMINATED, GAME_END, ERROR,

  // Game-specific
  DICE_RESULT, GO_SIGNAL, TAP_RESULT,
  TAP_COUNT, ANSWER_RESULT,
}
```

---

## Error Handling

- Invalid JSON → `ERROR` message sent to client
- Unknown message type → `ERROR` with type name
- Validation failure (bad wallet format, missing fields) → `ERROR` with details
- Not in a game when trying to act → `ERROR: "Not in a game"`
- Game not found → `ERROR: "Game not found for this giveawayId"`
- Game no longer active → `ERROR: "Game is no longer active"`
