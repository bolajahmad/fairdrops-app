# Games and the session runtime

Every giveaway is decided by a game. The host picks the game and its settings when creating the
giveaway, and they are part of the metadata committed on-chain, so they cannot change once the
prize is escrowed. FairDrops plays the game as a **session**, publishes a **transcript** of
everything that happened, and settles the result on-chain ([settlement.md](settlement.md)).

There are two kinds of game:

| Mode       | Who runs it                           | How the result is checked                                 |
| ---------- | ------------------------------------- | --------------------------------------------------------- |
| `HOSTED`   | FairDrops, from `@fairdrops/game-kit` | Anyone replays the transcript and gets the same standings |
| `EXTERNAL` | The developer's own server and UI     | The report is signed by the key registered for the game   |

## Pieces

```mermaid
flowchart TD
    subgraph Player_UI["player UI (ours or a third party's)"]
        direction TB
        A1[REST: sign in, join]
        A2[WebSocket /ws: subscribe, act]
    end
    subgraph External_Server["external game server"]
        direction TB
        B1[REST + API key:<br>read players,<br>POST score report]
    end

    subgraph API["apps/api"]
        API1
    end

    subgraph Redis["Redis stream / pub/sub"]
        RS[XADD action]
        RV[fd:session:&lt;id&gt;:actions]
        PUB[PUBLISH views]
        SUB[SUBSCRIBE]
    end

    subgraph Worker["apps/worker: SessionOwner<br>(one per game)"]
        WO[logs actions + advances cursor<br>in one Postgres transaction]
    end

    subgraph Planner["apps/worker: SessionPlanner (one leader)"]
        PL[BullMQ: seed commits, starts]
    end

    %% Player UI interactions
    A1-->|REST|API1
    A2-->|WS|API1

    %% External server interaction
    B1-->|REST|API1

    %% API to Redis
    API1-->|XADD action|RS

    %% Redis stream to SessionOwner
    RS-->|stream|WO

    %% Redis pub/sub for gateway
    SUB-->|SUBSCRIBE|API1
    PUB-->|PUBLISH views|SUB

    %% SessionOwner publishes views back via Redis
    WO-->|PUBLISH views|PUB

    %% Redis stream branch showing fd:session:<id>:actions
    RS-->|fd:session:<id>:actions|RV

    %% Planner for seeds/starts
    PL

    %% Direct relationship for planner
    PL---WO
```

- **`packages/game-kit`**: the game interface, the two built-in games (quiz and dice), seeded
  randomness, the transcript format and `replay`/`verifyTranscript`. It has no server
  dependencies, so a browser can verify a transcript with it.
- **`apps/worker`**: plans sessions, commits seeds on-chain, starts games, and runs them.
- **`apps/api`**: REST endpoints for sessions, and the WebSocket gateway players connect to.

## Session lifecycle

```mermaid
stateDiagram-v2
    [*] --> SCHEDULED

    SCHEDULED --> SEED_COMMITTED: seed committed on-chain
    SCHEDULED --> FAILED: start time,\nno seed committed

    SEED_COMMITTED --> LOBBY: lobby lead
    SEED_COMMITTED --> CANCELLED: nobody joined,\nor giveaway ended on-chain
    SEED_COMMITTED --> FAILED: start time,\nno players

    LOBBY --> RUNNING: start time
    LOBBY --> CANCELLED: nobody joined,\nor giveaway ended on-chain

    RUNNING --> SETTLING: hosted: game's duration ends\nexternal: score report arrives
    RUNNING --> FAILED: (external): no report before endsAt

    SETTLING --> FINALIZING: finalize sent
    FINALIZING --> FINALIZED: result indexed on-chain
    SETTLING --> FAILED: nobody qualified,\nor it cannot be finalized
    FINALIZING --> FAILED: deadline passed

    CANCELLED --> [*]
    FAILED --> [*]
    FINALIZED --> [*]
```

| Transition                          | Made by                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| giveaway indexed -> `SCHEDULED`     | Planner, for every active giveaway with valid metadata                                                                                                            |
| -> `FAILED` at planning             | Planner: unknown or unapproved game, invalid settings, missing question bank, a game that cannot end before the finalize deadline, or a start time already passed |
| `SCHEDULED` -> `SEED_COMMITTED`     | Seed commit job, once `commitSeed` has a successful receipt                                                                                                       |
| `SEED_COMMITTED` -> `LOBBY`         | Planner, `SESSION_LOBBY_LEAD_SECONDS` before the start                                                                                                            |
| -> `RUNNING`, `CANCELLED`, `FAILED` | Start job at the start time; the planner also starts overdue sessions                                                                                             |
| `RUNNING` -> `SETTLING` (hosted)    | The session's runtime, at the end of play                                                                                                                         |
| `RUNNING` -> `SETTLING` (external)  | Planner, once a valid score report is stored                                                                                                                      |
| `RUNNING` -> `FAILED` (external)    | Planner, if no report arrives before `endsAt`                                                                                                                     |
| any open status -> `CANCELLED`      | Planner, when the giveaway is cancelled or expires on-chain                                                                                                       |
| `SETTLING` onwards                  | The settlement pipeline; see [settlement.md](settlement.md)                                                                                                       |

Every transition is an `UPDATE ... WHERE status = <expected>`. A planner tick, a queued job and
a runtime that race over one session cannot both apply a change; the loser updates no rows.
Database `CHECK` constraints enforce the fields each status needs, for example a settled session
must have its ranking, transcript hash, revealed seed and end time.

Players can join in `SCHEDULED`, `SEED_COMMITTED` and `LOBBY`, before the start time. The player
list is fixed once the game starts: joining takes a share lock on the session row and starting
takes an exclusive one, so a join lands either before the start or not at all. The host of a
giveaway cannot join it.

## Seeds

Each session gets a random 32-byte seed when it is planned. It drives every random choice in the
game, such as the question order or the dice, so it must be fixed before play and secret until
the end:

1. The worker stores it encrypted with `SESSION_SEED_KEY` (AES-256-GCM).
2. The operator key calls `commitSeed(giveawayId, keccak256(abi.encode(giveawayId, seed)))`
   before the start. The contract refuses commitments after the start time.
3. When the game ends, the seed is written in the clear, published in the transcript, and
   revealed on-chain at finalization, where the contract checks it against the commitment.

Commits run one at a time per worker, retry with exponential backoff, and check the chain first,
so a retry after a crash does not send a second transaction. A different commitment already
on-chain fails the session.

## The runtime

A hosted game runs in exactly one worker at a time, its **owner**:

- **Claiming.** Every worker's supervisor looks for running hosted sessions each second and
  claims unowned ones with a Redis lease (`SESSION_LEASE_MS`), up to `SESSION_MAX_OWNED`.
- **Actions.** The gateway appends each player action to the session's Redis stream. The owner is
  its only reader. For each batch it assigns sequence numbers, applies the actions to the game,
  and in **one Postgres transaction** inserts them into `session_actions` and advances the
  session's stream cursor, conditional on the cursor it last wrote. Then it publishes views.
- **Fencing.** A lease can be held twice if a worker pauses past its expiry. The conditional
  cursor update means only one writer succeeds; the other finds zero rows updated and stops.
- **Restarts.** A new owner rebuilds the game by replaying `session_actions`, then reads the
  stream on from the stored cursor. Nothing sent while no worker was running the game is lost,
  and a resent action (same client id) is logged once.
- **One clock.** An action's time is its Redis stream id, and the owner reads "now" from Redis,
  so every lateness decision uses the same clock however many API instances there are.
- **The end.** When Redis's clock passes the game's end, the owner drains the stream (anything
  appended before the end is in it by then), ranks the players, builds the transcript and
  settles in one transaction with the transcript row.

Views are published through Redis: the latest public view and each player's view are stored
(for players who connect mid-game) and published on `fd:session:<id>:events`, which every API
instance relays to its sockets. Public updates caused by actions are coalesced to at most five
a second; phase changes (the next question) publish at once.

## Writing a hosted game

A hosted game implements `HostedGame` from `@fairdrops/game-kit`:

| Member              | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `config`, `action`  | zod schemas for the host's settings and a player's action           |
| `resources(config)` | Content it needs by hash, such as a question bank                   |
| `check`             | Reasons this config cannot be played, reported at planning          |
| `duration`          | Milliseconds from start to end                                      |
| `checkpoints`       | Times the public view changes without an action                     |
| `init`, `apply`     | Build the state; apply one action (return a rejection, never throw) |
| `publicView`        | What anyone may see at a time; never hidden information             |
| `playerView`        | What one player may see                                             |
| `rank`              | Final standings, best first, every tie broken                       |

It must be deterministic: randomness only from the seeded `Rng`, time only from `startAt`, the
action's `at` and the `now` given to views, and integer scores. Phases are functions of time,
so the runtime never logs clock ticks and a replay needs only the action log.

### Seeded randomness

`Rng` is a stream of bytes, `sha256(seed || uint16be(len(label)) || utf8(label) ||
uint32be(i))` for `i = 0, 1, ...`. `uint32()` reads 4 bytes big-endian; `int(n)` rejects values
at or above `floor(2^32 / n) * n` so every result is equally likely; `fork(name)` is the stream
labelled `<label>/<name>`. A test checks the implementation against Node's own SHA-256.

### Quiz

Settings: `bank` (a question bank's hash, required), `questions` (1 to 50, default 10),
`secondsPerQuestion` (5 to 60, default 15) and `revealSeconds` (0 to 15, default 3).

- Questions are drawn from the bank by the seed. Each is open for `secondsPerQuestion`, then its
  answer is shown for `revealSeconds`.
- One answer per player per question, accepted only while that question is open.
- Most correct answers wins; ties go to the lower total time taken on correct answers, then to
  the lower address.
- The public view never contains the answer to an open question, and the leaderboard only
  counts closed questions.

Question banks are uploaded by an admin (`POST /game-resources` with `kind: "quiz-bank"`) and
stored privately under the hash of their canonical JSON. The host puts that hash in the
settings, which commits the giveaway to the bank on-chain without revealing the answers. The
transcript publishes the bank when the game is over. Hosts cannot upload banks, because whoever
writes a bank knows its answers.

### Dice

Settings: `rolls` (1 to 10, default 3), `dice` (1 to 5, default 2), `sides` (4 to 20, default 6)
and `windowSeconds` (30 to 900, default 120).

- Each player rolls up to `rolls` times before the window closes. Each roll's values come from a
  stream labelled by player and roll number, so they do not depend on anyone else's timing.
- Highest total wins; ties go to the best single roll, then a seeded draw, then the address.

## External games

A third party can run its own game, with its own UI and server, and use FairDrops for the prize,
the players and the result:

1. **Register** the game (`POST /games`, mode `EXTERNAL`) with `reporterAddress`, the key that
   will sign results, and `uiUrl`. Once approved, players can sign in to FairDrops from the UI's
   origin, and hosts can pick the game.
2. **Players sign in and join** from the game's UI: `POST /auth/nonce`, `POST /auth/verify`
   with `transport: "body"`, then `POST /sessions/:id/join` before the start.
3. **The game runs** on the developer's servers between `startsAt` and `endsAt` (the finalize
   deadline minus `SESSION_SETTLEMENT_MARGIN_SECONDS`). Its server reads the session and the
   player list from `GET /sessions/:id` and `GET /sessions/:id/participants`.
4. **The server reports** the final standings with `POST /sessions/:id/score-report`, an API
   key with `scores:write` owned by the game's developer, and an EIP-712 signature from the
   reporter key:

   ```ts
   import { hashJson } from "@fairdrops/game-kit";
   import { SCORE_REPORT_DOMAIN, SCORE_REPORT_TYPES } from "@fairdrops/shared";

   const ranking = [
     { player: "0xabc...", score: 120 },
     { player: "0xdef...", score: 80 },
   ]; // best first, lowercase
   const signature = await reporter.signTypedData({
     domain: SCORE_REPORT_DOMAIN,
     types: SCORE_REPORT_TYPES,
     primaryType: "ScoreReport",
     message: {
       sessionId,
       chainId: BigInt(chainId),
       giveawayId,
       rankingHash: hashJson(ranking),
       gameTranscriptHash: ZERO_HASH, // or the hash of the game's own log
     },
   });
   ```

   FairDrops checks the key's owner, the signature, that every ranked player joined, that the
   game is running and before its deadline, and accepts one report per session.

5. **FairDrops settles** it on the planner's next pass: ranks follow the reported order, and the
   transcript records the report and signature. The result is served to FairDrops's own UI like
   any other game's, through `GET /sessions/:id` and the `status` event on the socket.

FairDrops cannot replay an external game. Its guarantees are that the result came from the
registered key, covers only players who joined before the start, and cannot change once settled.

## Transcripts

When a game ends, its transcript is stored in `session_transcripts` and served unchanged by
`GET /sessions/:id/transcript`. Its `keccak256` over the canonical JSON is the `transcriptHash`
settled on-chain.

A hosted transcript contains the session and contract, the game and its settings, the seed, the
start and end, the players, the resources used (such as the question bank), every sequenced
action with its time, and the standings. `verifyTranscript` replays it and checks the standings;
it also rejects tampered resources and gaps in the log.

## WebSocket protocol

Connect to `/ws`, with `?ticket=` from `POST /auth/ws-ticket` to play, or without one to watch.
Messages are JSON; the schemas are `clientMessageSchema` and `serverMessageSchema` in
`@fairdrops/shared`.

| Client sends                                | Server answers                                        |
| ------------------------------------------- | ----------------------------------------------------- |
| `{ type: "subscribe", sessionId }`          | `snapshot`: status, public view, your view            |
| `{ type: "action", sessionId, id, action }` | `received`, then a `player` message with the `result` |
| `{ type: "unsubscribe", sessionId }`        |                                                       |
| `{ type: "ping", t }`                       | `pong`                                                |

Subscribers also get `public` (the public view changed), `player` (your view changed) and
`status` (with the standings when the game ends). Errors carry a code: `BAD_MESSAGE`,
`UNAUTHENTICATED`, `NOT_FOUND`, `NOT_A_PLAYER`, `NOT_RUNNING`, `INVALID_ACTION`, `RATE_LIMITED`.

Limits: 4 KB messages, 20 actions a second per socket, 10 sessions per socket, and clients more
than 1 MB behind on reading are dropped (they reconnect and get a snapshot). The server pings
every 30 seconds and drops sockets that do not answer.

## API

| Route                                            | Access                      |
| ------------------------------------------------ | --------------------------- |
| `GET /sessions/:id`                              | Public                      |
| `GET /sessions/by-giveaway/:chainId/:giveawayId` | Public                      |
| `GET /sessions/:id/participants`                 | Public, cursor pagination   |
| `POST /sessions/:id/join`                        | Signed in                   |
| `GET /sessions/:id/transcript`                   | Public, once the game ends  |
| `POST /sessions/:id/score-report`                | API key with `scores:write` |
| `POST /game-resources`, `GET /game-resources`    | Admin                       |

The seed, standings and transcript hash are null in session views until the game is over.

## Registering the built-in games

Hosted games need an approved definition like any other. Print the request bodies, create them
with `POST /games` as an admin, then submit and approve them:

```bash
pnpm --filter @fairdrops/api games:builtin
```

## Configuration

| Variable                            | App    | Default | Meaning                                                    |
| ----------------------------------- | ------ | ------- | ---------------------------------------------------------- |
| `SESSIONS_ENABLED`                  | worker | `true`  | Run the planner, jobs and runtimes                         |
| `SESSION_SEED_KEY`                  | worker |         | 32-byte hex key encrypting seeds; required in production   |
| `OPERATOR_PRIVATE_KEY`              | worker |         | Commits seeds; without it every session fails at its start |
| `SESSION_PLANNER_INTERVAL_MS`       | worker | `2000`  | Planner tick                                               |
| `SESSION_SETTLEMENT_MARGIN_SECONDS` | worker | `900`   | Time kept free before the finalize deadline                |
| `SESSION_LOBBY_LEAD_SECONDS`        | worker | `300`   | When the lobby opens                                       |
| `SESSION_MAX_OWNED`                 | worker | `50`    | Games one worker runs at a time                            |
| `SESSION_LEASE_MS`                  | worker | `10000` | How long a runtime's claim lasts without renewal           |
| `SESSION_MAX_PLAYERS`               | api    | `10000` | Players per session (a soft cap)                           |
| `WS_MAX_CONNECTIONS`                | api    | `20000` | WebSocket connections per API instance                     |

`SESSION_SEED_KEY` must stay the same while sessions are open; changing it makes their seeds
unreadable and they fail.

## Trust assumptions

- The worker and anyone with its database and `SESSION_SEED_KEY` know seeds before play. They
  cannot change a committed seed, but could leak it. A leaked dice seed reveals every roll; a
  leaked quiz seed reveals the question order, not the answers.
- Question banks are written by admins, who know the answers.
- The API's gateway decides which actions reach the stream. The runtime re-checks that each one
  comes from a player and is well-formed, and the transcript lets anyone check the rest.
- External games are trusted to the extent of their reporter key.

## Playing a game locally

`apps/api/scripts/play-session.ts` plays one hosted game end to end against running processes,
the way real players would, then checks the result the way anyone could.

**What is real:** the API and worker processes, Postgres, Redis, SIWE sign-in, joining over
REST, WebSocket tickets, the gateway, the action stream, the worker's planner, supervisor and
runtime, the pub/sub relay, settling, the transcript and its replay.

**What the script stands in for:** the chain. It inserts the giveaway the indexer would have
copied from a `GiveawayCreated` event, and a session already in `SEED_COMMITTED` with a seed it
encrypts with the worker's key, so no testnet, subgraph or operator key is involved. After the
players join it moves the start time a few seconds ahead, and the worker's planner starts the game
on its next tick. On-chain seed commits are covered by tests with a fake committer only.

### Running it

Use a separate database and Redis index so development data is untouched. In one terminal:

```bash
docker exec fairdrops-postgres-1 psql -U fairdrops -d postgres -c "CREATE DATABASE fairdrops_play"
export DATABASE_URL=postgresql://fairdrops:fairdrops@localhost:5432/fairdrops_play
export REDIS_URL=redis://localhost:6379/12
export SESSION_SEED_KEY=$(openssl rand -hex 32)
pnpm --filter @fairdrops/db db:migrate
pnpm turbo run build --filter=@fairdrops/api --filter=@fairdrops/worker
```

Then start one or more API instances and a worker, each in its own terminal with the same
exports:

```bash
cd apps/api && API_PORT=3099 node dist/main.js
cd apps/api && API_PORT=3100 node dist/main.js
cd apps/worker && INDEXER_ENABLED=false SESSION_PLANNER_INTERVAL_MS=500 node dist/main.js
```

And play:

```bash
pnpm --filter @fairdrops/api play --api http://127.0.0.1:3099,http://127.0.0.1:3100 --players 3
```

It prints each player's accepted and rejected actions, the standings, and five checks: the
session settled, the revealed seed is the committed one, the transcript hash matches, replaying
the transcript gives the same standings, and the standings pushed over the socket match REST. It
exits non-zero if any check fails.

### Scenarios

| To test                             | Do                                                                    |
| ----------------------------------- | --------------------------------------------------------------------- |
| Quiz instead of dice                | `--game quiz --questions 5 --accuracy 0.6`                            |
| Many players                        | `--players 50`                                                        |
| Players spread over API instances   | several URLs in `--api`; each player's views still arrive via pub/sub |
| Someone acting without joining      | `--outsider`; expect `NOT_A_PLAYER`                                   |
| More dice or a longer window        | `--rolls 5 --window 60`                                               |
| A worker crash mid-game             | `kill -9` the worker during play, start a new one                     |
| A graceful worker restart           | `kill -TERM` the worker during play, start a new one                  |
| Two workers sharing games           | start a second worker; one claims each game                           |
| Redis or an API instance going away | stop it during play and watch what players and the checks report      |

After a crash the new worker waits for the old lease to lapse (`SESSION_LEASE_MS`, 10 s by
default), then rebuilds the game from the logged actions. Nothing already sent is lost, but
players see no new public view in that gap: in a quiz, a question that opens and closes entirely
inside it is never shown. A graceful stop releases the lease at once, so the gap is about a
second. A shorter `SESSION_LEASE_MS` narrows the crash gap at the cost of more Redis traffic.
