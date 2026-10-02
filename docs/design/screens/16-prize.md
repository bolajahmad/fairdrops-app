# Create 2 · The prize

**Flow:** Host · mobile · **Route (proposed):** `/host/new`

Everything editable on one screen. The split preview updates as you type.

| Light                                                       | Dark                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| ![Create 2 · The prize, light](../images/h-prize-light.png) | ![Create 2 · The prize, dark](../images/h-prize-dark.png) |

## Layout, top to bottom

- Field "Name", prefilled.
- **Prize, amount and token in one box:** the amount on the left (Bricolage 800), the token on the right as a pill (token avatar with a network dot, symbol, chevron) that opens the token picker. Directly underneath, always: trust badge (Verified / Listed / Unverified), network, decimals, a short contract link, and "Balance 240 USDC" (tap to use it all) once a wallet is connected. The network is never chosen separately: it is the token's.
- **Token picker sheet** ("Choose the prize token"): a search field (name, symbol or contract address), network chips (All networks plus each hostable network), a "Connect your wallet to see the tokens you hold" prompt, then **Your tokens** (held tokens with balances), then **All tokens** / **Matches** / **Found at that address**. Each row: avatar, symbol, trust badge, "name · network", balance. Empty: "No token matches. Paste the token's contract address to use any ERC-20."
- **Unverified or listed token:** a flare notice under the prize box with the warning (a pointed one for lookalikes such as a second "USDC"), the full contract address, "View contract", and a required tick: "I've checked this is the LINK I mean. Players will see it's unverified." Next stays disabled until it is ticked.
- Winners stepper: − / count / +, 1 to 50.
- Segmented split: "Equal" / "Top gets more" (the `equal` / `weighted` reward policy).
- Place preview: the top 3 as bars with amounts, then "+N more places".
- Game chips (toggle, stage-coloured icon): Tap Rush, Quiz, Dice.
- Segmented start: "In 15 min" / "Tonight 8:30" / "Pick time" (which opens a date-time sheet).
- Sticky: "Next: review →", disabled while invalid.

## States

- **Errors** (inline, on the field):
  - "That's more than you have (540.00 USDC)";
  - "Pick at least 1 winner";
  - "Start must be at least 2 minutes from now";
  - the game window must be between 10 minutes and 30 days (contract limits).

## Data

- `prepareGiveaway(input)` from `@fairdrops/sdk/host` validates and builds the metadata; `InvalidGiveawayError` messages map to the field errors.
- Tokens: `fd.tokens.search({ q, chainId })` (symbol, name or a pasted address; unknown addresses are read from the chain once and cached) and `fd.tokens.get(chainId, address)`. Hostable networks come from `hostableChains(environment)`: deployed and indexed, so Polkadot Hub is not offered.
- Balances: `balancesOf(owner, tokens)` from `@fairdrops/sdk/host`.
- The picked token is kept whole (`TokenView`: chain, address, symbol, name, decimals, trust) through review and lock, so its context is never re-derived or lost.

## Navigation

- Next → Review and lock.
