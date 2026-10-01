# Screens

Every screen in flow order. Each file has light and dark screenshots, the layout from top to bottom with the real copy, every state, the SDK calls it needs, and where it navigates.

- Phone screenshots are 390×844 at 2x; desktop screenshots are 1280×820.
- They are captured from the [reference prototype](../reference/README.md), which is also [live](https://claude.ai/artifact/GRWAd3HRxA6sWpa8nVigX1) for sharing.
- Routes are proposals for `apps/web` (Next.js App Router).
- Play screens are one route (`/play/[sessionId]`) that swaps stages as the room's state changes.

## Player · mobile

| #   | Screen                             | Route                                  | Purpose                                                                                                             |
| --- | ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 01  | [Giveaway page](01-giveaway.md)    | `/g/[chainId]/[giveawayId]`            | Where a shared link lands. It sells the prize, explains the games and how fairness works, and has one action: Join. |
| 02  | [Join sheet](02-signin.md)         | `sheet over /g/[chainId]/[giveawayId]` | Sign in without crypto words. A wallet is created quietly to receive the prize.                                     |
| 03  | [Lobby](03-lobby.md)               | `/play/[sessionId]`                    | Keeps players on the page until the first game. It shows the countdown, the line-up and a sound check.              |
| 04  | [Game 1 · Dice](04-dice.md)        | `/play/[sessionId] (stage: dice)`      | The Dice game. The whole screen takes the Dice stage ground.                                                        |
| 05  | [Next game](05-next.md)            | `/play/[sessionId] (between games)`    | Makes the switch between games obvious. The ground changes to the next game's stage colour, with a 3-2-1 count.     |
| 06  | [Game 2 · Tap Rush](06-tap.md)     | `/play/[sessionId] (stage: tap)`       | The speed game. Tap as fast as possible for 15 seconds.                                                             |
| 07  | [Game 3 · Quiz](07-quiz.md)        | `/play/[sessionId] (stage: quiz)`      | The quiz game. Faster right answers score more.                                                                     |
| 08  | [Counting results](08-settling.md) | `/play/[sessionId]/results`            | Settlement in player words while the worker builds, signs and submits the result.                                   |
| 09  | [Results](09-results.md)           | `/play/[sessionId]/results`            | The one orchestrated moment: your place, the board rising in, then your prize.                                      |
| 10  | [Collecting](10-collecting.md)     | `/play/[sessionId]/results`            | The prize on its way, with a busy state that can't be double-tapped.                                                |
| 11  | [Collected](11-collected.md)       | `/play/[sessionId]/results`            | Celebrate and share. The proof is one tap away.                                                                     |
| 12  | [How we checked](12-verify.md)     | `/g/[chainId]/[giveawayId]/verify`     | Runs the verification in the player's browser and explains it in plain words.                                       |
| 13  | [My prizes](13-prizes.md)          | `/me/prizes`                           | Everything you've won, what's left to collect, and where prizes go.                                                 |

## Host · mobile

| #   | Screen                                     | Route                                | Purpose                                                                                                                |
| --- | ------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 14  | [Hosting home](14-home.md)                 | `/host`                              | A host's giveaways and totals. The main action is always Create.                                                       |
| 15  | [Create 1 · Who's it for?](15-audience.md) | `/host/new`                          | One tap picks a preset that fills in every default.                                                                    |
| 16  | [Create 2 · The prize](16-prize.md)        | `/host/new`                          | Everything editable on one screen. The split preview updates as you type.                                              |
| 17  | [Create 3 · Review and lock](17-review.md) | `/host/new`                          | A plain summary, then approve and lock in two wallet steps.                                                            |
| 18  | [Published](18-live.md)                    | `/host/[chainId]/[giveawayId]/share` | Share straight away.                                                                                                   |
| 19  | [Manage](19-manage.md)                     | `/host/[chainId]/[giveawayId]`       | Before the start: add to the prize, share or cancel. During the game: watch the live board. After: withdraw leftovers. |

## Desktop

| #   | Screen                                       | Route         | Purpose                                                                  |
| --- | -------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| 20  | [Discover (desktop)](20-discover.md)         | `/`           | Find giveaways, and see who gives and wins the most.                     |
| 21  | [Hosting dashboard (desktop)](21-hosting.md) | `/host`       | Every giveaway a host has run, and what needs action.                    |
| 22  | [Developers (desktop)](22-developers.md)     | `/developers` | Register third-party games and manage API keys. Games keep their own UI. |
