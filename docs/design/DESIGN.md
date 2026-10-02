# FairDrops design

Read this file first. It is the entry point to the FairDrops design system and screens, written so a person or a language model can build the web UI from it without seeing anything else.

**Status:** first draft, under review. The direction is not signed off yet. Where the design and the backend disagree, [Open questions](#open-questions) says so.

| Read                                                  | For                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| This file                                             | Product, audience, rules, and the map of everything else                            |
| [tokens.json](tokens.json) / [tokens.css](tokens.css) | Every colour (light and dark), type style, spacing, radius, shadow and motion value |
| [components.md](components.md)                        | The 15 components: purpose, props, states, rules                                    |
| [screens/README.md](screens/README.md)                | Every screen in flow order, one spec file each, with light and dark screenshots     |
| [reference/](reference/README.md)                     | Working reference code: the component bundle and the clickable prototype            |
| [logo/](logo/)                                        | The mark as SVG in four variants                                                    |

The design lives in two places:

- **Live versions**, which need a claude.ai sign-in and must be shared by the owner:
  - [design system](https://claude.ai/artifact/MvJ9MEsFwJKGPtXQyW8Yk8);
  - [clickable prototype](https://claude.ai/artifact/GRWAd3HRxA6sWpa8nVigX1).
- **This folder**, which is the source of truth for building.

## The product

FairDrops turns a giveaway into a game:

1. A host locks a prize in a smart contract.
2. People play short games on their phones.
3. The leaderboard decides the winners.
4. Anyone can check that nobody cheated.

The contract runs on any EVM chain; Monad testnet is the demo chain. The UI talks only to the API through `@fairdrops/sdk` ([docs/sdk.md](../sdk.md)).

**It should feel like an arcade you can trust: playful on the surface, exact underneath.** The words for that are _playful, trustworthy, Gen-Z, a little arcade_.

## Who it's for

- **Players:** anyone who taps a link on social media.
  - Most have never used crypto. FairDrops is not a crypto lesson, so hide the crypto.
  - Mostly on phones: one hand, a few minutes, often a weak connection.
- **Hosts:** they matter as much as players, because hosts bring the players.
  - Community and meetup leaders rewarding members. Leaderboard places can also unlock gifts outside the app.
  - Creators and influencers giving back to their followers.
  - Crypto projects giving out their own token. The app shows how to receive it.
  - Hosting must be fast: from nothing to a shareable link in under a minute, with audience presets that fill in the defaults.
- **Developers:** they build their own game UIs and report scores through the SDK. Games are generic and not tied to FairDrops' UI.
- **Admins:** out of scope for now.

## Rules that matter most

1. **One brand colour and one urgency colour.**
   - `lagoon` (teal) is the brand, **all money**, primary actions and anything verified.
   - `flare` (orange) means **live**: the live and ending-soon chips.
   - Countdowns: counting down to a **start** is green (`lagoon`, or `stage-go` on a stage) the whole way; counting down to a **cutoff** (a quiz question, a round, a giveaway's end) turns red (`danger`, or `stage-alert` on a stage) in its last seconds, and players are expected to answer anyway.
   - Use no other hues apart from the neutrals, `danger`, and the game stage grounds.
   - No yellow and nothing gender-coded.
2. **Every game kind has its own dark stage ground:** `stage-dice`, `stage-quiz`, `stage-tap`, `stage-custom`.
   - The play screen takes the whole stage colour.
   - When a giveaway moves to its next game, the ground changes, so players notice.
   - Stages are dark in both themes.
3. **No crypto words for players.** Use these instead:

   | Say              | Not          |
   | ---------------- | ------------ |
   | Collect prize    | claim        |
   | Counting results | settling     |
   | Your wallet      | an address   |
   | Verified fair    | Merkle proof |
   - Never mention gas: the relayer pays it.
   - Chains, hashes and contracts appear only under _Technical proof_ on the verify screen.

4. **Anything you can press has a solid press edge** (`edge-*` shadows) and sinks when pressed, like an arcade key. Cards never get an edge.
5. **Fairness is quiet.** Put one `FairBadge` on each result or payout. Tapping it runs `verifyGiveaway()` from `@fairdrops/sdk/verify` in the browser and shows four plain checks. It is never a banner.
6. **Server time only.** Every countdown uses `LiveConnection.now()` / `clockOffsetMs`, never the device clock.
7. **Themes:** Auto (the default, following the device), Light and Dark.
   - Every text pair holds WCAG AA contrast in both themes.
   - The focus ring is `focus`, or `on-stage` when on a stage.
8. **Motion and sound:**
   - Motion is quick and springy.
   - Use one orchestrated moment per flow: the results reveal.
   - Honour `prefers-reduced-motion`.
   - Game sounds are on during games and off elsewhere, and never play before the first tap. The mute toggle sits in every game header and is remembered per device.
9. **Languages:** English now; Spanish, French and German next, all left-to-right.
   - Leave about 35% room for longer text; buttons and chips grow, never truncate.
   - Put no words in images.
   - Use `Intl` for numbers, dates and currency.
10. **Tokens:** any ERC-20 on a hostable network can be a prize. An amount is never shown without its token's symbol, and wherever someone acts on it (picking, reviewing, locking, managing, collecting), also with its network, decimals and trust level (Verified / Listed / Unverified). Unverified tokens always show their contract address and a warning, to hosts and players alike. If a token can't be read at all, amounts show as "units of 0x…", never with a guessed symbol or scale.
11. **Money display:**
    - The token amount comes first ("40 USDC").
    - An optional local estimate follows, marked "≈" ("≈ ₦61,600").
    - Never show raw wei.

## Visual summary

|               | Light                                                      | Dark                      |
| ------------- | ---------------------------------------------------------- | ------------------------- |
| Page          | `surface` #f4f8f7                                          | #0a1413                   |
| Text          | `ink` #0d1f1e                                              | #e8f1ef                   |
| Brand, money  | `lagoon` #087a70                                           | #3fc9b6 (dark text on it) |
| Time, urgency | `flare` #c44a17                                            | #ff8a5b                   |
| Error         | `danger` #b4233a                                           | #ff6b7f                   |
| Stages        | dice #0b3d3a · quiz #1b2350 · tap #3b1f14 · custom #22252b | same                      |

**Type**

- **Bricolage Grotesque** (display, chunky and a bit quirky): headings from 20px up.
- **Figtree:** everything people read and tap. Inputs are at least 16px.
- **Martian Mono:** timers, scores and hashes.
- Money uses the display face with tabular figures.

**Shape**

- Radii: 8 inputs · 14 buttons · 20 cards · 28 stages and sheets · pill chips.
- Cards are flat: `surface-raised` with a `line` outline.
- The `lift` shadow is only for floating layers (sheets, the sticky action bar).

**Layout**

- Play and claim screens are one column, at most 480px wide, with the main action in a sticky bottom bar.
- Host and discovery screens use a 12-column grid up to 1200px.
- Giveaway grids use `minmax(260px, 1fr)`.
- Gutters are 16px on mobile and 24px on desktop.

**Icons:** Lucide, 1.75 stroke. Game kinds have fixed icons: dice → `dice`, quiz → `circle-help`, tap → `pointer`, custom → `puzzle`.

**Logo:** a drop landing in cupped hands. The drop is `lagoon` and the hands are `ink`. The wordmark is live text: "FairDrops" in Bricolage Grotesque 800 at -3% tracking.

## Building it

- **Stack:** `apps/web` in Next.js App Router, Tailwind v4 and shadcn/ui on Radix.
- **Tokens:** put `tokens.css` in the global stylesheet and map the tokens to Tailwind theme variables.
  - shadcn's `--primary` is `lagoon`, `--ring` is `focus` and `--radius` is 14px.
- **Theme:** `next-themes` with `attribute="data-theme"` and `defaultTheme="system"`.
- **Fonts:** load them with `next/font/google`.
- **Components:** rebuild the components in [components.md](components.md) as typed React components.
  - [reference/bundle.js](reference/bundle.js) is a working but framework-free version of each. Match its behaviour and states, not its code style.
- **Data:** every screen spec lists the SDK calls it uses. Phases map to chips as in [components.md → StatusChip](components.md#statuschip).

## Open questions

These need a decision before or during the build:

1. **Collecting prizes vs the relayer.**
   - By default the worker's `ClaimRelayer` claims every prize for the winners automatically after finalization (`CLAIM_RELAY_ENABLED=true`; see [settlement.md](../settlement.md)).
   - The prototype shows a "Collect prize" button, which implies the player acts.
   - **Proposed:** with relaying on, the results screen shows the claim card in _Sending_ and then _Collected_, with no button. The _Collect_ button (self-claim via `claimPrize`) appears only when relaying is off, or when the relayer hasn't delivered within a set time.
   - The host copy "Unclaimed prizes come back to you" still applies to self-claim deployments.
2. **Local currency estimate:** it is shown in naira for the demo. Where does the rate come from, and which currency should show outside Nigeria?
3. **Sign-in:** the join sheet assumes Web3Auth, with Google and email creating an embedded wallet, plus "I already have a wallet". Confirm the providers.
4. **Top gifters / top earners boards:** these need an API endpoint that doesn't exist yet (totals per host and per player per month).
5. **Leaderboard places unlocking offline gifts** (for community hosts): not designed yet. It is likely a host-side "Perks by place" section plus a line on the winner's result.
