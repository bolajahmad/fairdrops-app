# SDK

`@fairdrops/sdk` is the client every interface uses: the FairDrops web app, third-party game UIs,
external game servers, hosts' scripts and anyone checking a result. It runs in browsers and in
Node 24, never holds private keys, and validates every API response with the schemas the API is
written against (`@fairdrops/shared`), so a mismatch fails loudly instead of rendering wrong data.
It targets testnets and mainnet; there is no local-chain mode.

| Import                  | For                                                        |
| ----------------------- | ---------------------------------------------------------- |
| `@fairdrops/sdk`        | `FairDrops`: sign in, giveaways, sessions, results, claims |
| `@fairdrops/sdk/live`   | `LiveConnection`: play and watch over the WebSocket        |
| `@fairdrops/sdk/host`   | Create, fund, cancel and withdraw giveaways                |
| `@fairdrops/sdk/claims` | Claim a prize from the winner's wallet; payout wallets     |
| `@fairdrops/sdk/verify` | `verifyGiveaway`: check a result against the chain         |
| `@fairdrops/sdk/server` | `ScoreReporter`, for external game servers                 |

`viem` is a peer dependency. Anything that signs takes a viem wallet client (injected wallets,
Web3Auth and WalletConnect all provide one), a viem local account, or your own `Signer`.

## Signing in

```ts
import { FairDrops } from "@fairdrops/sdk";

const fd = new FairDrops({ apiUrl: "https://api.fairdrops.example" });
const me = await fd.auth.signIn(walletClient, { chainId: 84532, connector: "web3auth" });
```

- Sign-In with Ethereum: the wallet signs a message, never a transaction.
- The message names the page's origin (or `origin` in the options, required in Node). FairDrops
  accepts its own web app and the `uiUrl` origins of approved games.
- Tokens are kept in a `TokenStore`: in memory by default, `LocalStorageTokenStore` to survive
  reloads. Access tokens refresh automatically before they expire, one refresh for any number of
  concurrent calls; a rejected refresh signs the client out.
- `transport: "cookie"` is for FairDrops' own web app only (HttpOnly refresh cookie).

## Reading

```ts
const page = await fd.giveaways.list({ chainId: 84532, status: "ACTIVE" }); // cursor pages
const giveaway = await fd.giveaways.get(chainId, giveawayId); // phase, rewards, metadata, session
const session = await fd.sessions.byGiveaway(chainId, giveawayId);
await fd.sessions.join(session.id); // signed in, before the start
const settlement = await fd.settlement.get(session.id); // payouts, root, signatures
const claim = await fd.claims.get(chainId, giveawayId, account); // amount + Merkle proof
const mine = await fd.claims.mine(); // every prize won by the user's wallets
```

Errors are `FairDropsError` with the API's stable `code` (`NOT_FOUND`, `CONFLICT`, …), or
`NETWORK` and `BAD_RESPONSE` for transport problems.

## Playing live

```ts
import { LiveConnection } from "@fairdrops/sdk/live";
import type { DicePlayerView, DicePublicView } from "@fairdrops/game-kit";

const live = await LiveConnection.connect(fd); // spectate: true to watch without signing in
const room = live.subscribe<DicePublicView, DicePlayerView>(session.id);
room.on("snapshot", ({ status, publicView, playerView }) => render(...));
room.on("public", (view) => render(view));
room.on("status", ({ status, ranking }) => showResult(status, ranking));

const result = await room.act({ type: "roll" }); // { id, seq, accepted, reason? }
const countdown = gameEndsAt - live.now(); // server clock, corrected for latency
```

What the connection handles so a UI does not have to:

- **Reconnection** with jittered backoff, a fresh ticket each time, every room subscribed again
  and resynced from a snapshot. `live.on("state", …)` reports `connecting`, `open`,
  `reconnecting` and `closed`.
- **Exactly-once actions.** Each action gets an id that is kept across reconnections; an action
  without a result is resent, and the server logs it once.
- **Rate limiting** on the client at the gateway's limit, so a burst fails locally with
  `RATE_LIMITED` instead of getting the socket cut.
- **Clock sync** from the gateway's pings: `live.now()`, `live.clockOffsetMs`, `live.roundTripMs`.

A third party's game UI can be any framework; it needs only these calls. Game-specific views come
from the game (built-in games export their view types from `@fairdrops/game-kit`).

## Hosting

```ts
import { createGiveaway, prepareGiveaway, withdraw } from "@fairdrops/sdk/host";

const prepared = prepareGiveaway({
  chainId: 84532,
  token: NATIVE_TOKEN_ADDRESS, // or an ERC-20; approval is handled
  amount: parseEther("0.1"), // fee included
  startTime,
  finalizeDeadline,
  maxWinners: 3,
  metadata: {
    v: 2,
    title: "Friday dice",
    description: "",
    game: { id: "dice", version: "1.0.0", config: { rolls: 3 } },
    rewards: { kind: "weighted", bps: [6000, 3000, 1000] },
  },
});
const { giveawayId } = await createGiveaway(walletClient, prepared);
```

`prepareGiveaway` checks everything the contract and FairDrops will (schedule limits, winner count,
metadata size, the reward policy against `maxWinners`) before any transaction. `withdraw` sends
the host whatever is owed: a full refund after a cancellation or a missed deadline, the
undistributed remainder after finalization, unclaimed prizes after the claim window.
`withdrawable` reads the amount first.

## Claiming

FairDrops relays claims for winners by default. To claim from the winner's own wallet:

```ts
import { claimPrize } from "@fairdrops/sdk/claims";

const claim = await fd.claims.get(chainId, giveawayId, account);
if (claim.claimable) await claimPrize(walletClient, claim);
```

## Verifying a result

```ts
import { verifyGiveaway } from "@fairdrops/sdk/verify";

const report = await verifyGiveaway(fd, chainId, giveawayId, { publicClient }); // your own node
report.ok; // every check passed
report.checks; // [{ name: "seed", ok: true, detail: "..." }, ...]
```

Nothing FairDrops says is taken on trust. The chain supplies the prize, the seed commitment, the
metadata hash and the settled result; FairDrops only supplies public documents (the metadata, the
transcript, the payout tree), each checked against a hash on-chain before it is used. The checks
are listed in [settlement.md](settlement.md#verification).

## External game servers

```ts
import { ScoreReporter } from "@fairdrops/sdk/server";

const reporter = new ScoreReporter({
  apiUrl,
  apiKey: process.env.FAIRDROPS_API_KEY, // scope scores:write
  reporter: privateKeyToAccount(process.env.REPORTER_KEY), // the game's reporterAddress
});
const players = await reporter.players(sessionId);
await reporter.report(sessionId, [
  { player: "0xabc…", score: 120 },
  { player: "0xdef…", score: 80 },
]); // best first
```

It builds and signs the EIP-712 score report described in [game-runtime.md](game-runtime.md#external-games).

## Tests

- `packages/sdk/test`: the HTTP client (schema checks, error codes, token refresh), the live
  client against an in-memory gateway (reconnection, resends, rate limits, clock), and host
  validation.
- `apps/api/test/sdk.test.ts`: the SDK against the real API over HTTP and WebSocket.
- `apps/e2e`: the SDK against a deployment on real testnets ([settlement.md](settlement.md#end-to-end-on-testnet)).
