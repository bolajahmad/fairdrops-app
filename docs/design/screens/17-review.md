# Create 3 · Review and lock

**Flow:** Host · mobile · **Route (proposed):** `/host/new`

A plain summary, then approve and lock in two wallet steps.

| Light                                                              | Dark                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| ![Create 3 · Review and lock, light](../images/h-review-light.png) | ![Create 3 · Review and lock, dark](../images/h-review-dark.png) |

## Layout, top to bottom

- A summary card, as a definition list: Prize · **Token** (avatar, symbol · name) · **Network** · **Contract** (full address, linked to the explorer; not shown for the network currency) · **Decimals** · Winners · Game · Starts · Unclaimed prizes. For an unverified or listed token, its warning repeats under the card.
- Trust note: "Your prize is locked in a public contract, so players can see it's real. Nobody, including us, can move it except to pay the winners or refund you."
- **Network notice**, above the payment options: which network the wallet is on (kept live as the user changes it), and the wallet requests that will follow, numbered: connect (if needed), switch to the token's network (if needed), allow the token (ERC-20s), lock. It turns lagoon with "Your wallet is on Base Sepolia. Ready to lock." when nothing needs switching.
- Sticky: Button `lg` with a lock icon, "Lock 250 USDC" (always the picked token's symbol), and the note "You can cancel for a full refund until it starts."

## States

- **Locking:** the network notice becomes a step list: "Switch your wallet to Base Sepolia" → "Allow FairDrops to use 250 USDC" → "Lock the prize and publish". Each shows "Confirm in your wallet", then "Waiting for Base Sepolia to confirm…", then Done; steps not needed say why ("Already on Base Sepolia", "Already allowed", "Not needed for ETH"). On failure the step that stopped is marked, with "Nothing after this step happened". Earlier wording: two steps appear: "Allow FairDrops to use 250 USDC" (the ERC-20 approve) and "Lock the prize and publish" (create). The button is busy and the note reads "Confirm in your wallet when asked."
- **Wallet rejected:** "You cancelled in your wallet. Nothing was locked." and the button is back.
- **Failed:** show what went wrong, and that nothing was taken if it failed before the lock.

## Data

- `createGiveaway(wallet, prepared)` from `@fairdrops/sdk/host` (approve, then create).

## Navigation

- Success → Published.
