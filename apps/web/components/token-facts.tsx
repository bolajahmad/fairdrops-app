import type { TokenView } from "@fairdrops/shared";
import { chainName, tokenExplorerUrl } from "@/lib/tokens";
import { TrustBadge } from "./trust-badge";

/**
 * The token's context in one line: network, decimals, trust, and a link to the contract. Shown
 * beside every amount a host or player acts on, so a symbol never appears without its network.
 */
export function TokenFacts({ token, contract = true }: { token: TokenView; contract?: boolean }) {
  const explorer = tokenExplorerUrl(token);
  return (
    <span className="caption flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink-muted">
      <TrustBadge trust={token.trust} />
      <span>{chainName(token.chainId)}</span>
      <span aria-hidden>·</span>
      <span>{token.native ? "Network currency" : `${token.decimals} decimals`}</span>
      {contract && !token.native ? (
        <>
          <span aria-hidden>·</span>
          {explorer ? (
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-lagoon hover:underline"
            >
              {token.address.slice(0, 6)}…{token.address.slice(-4)}
            </a>
          ) : (
            <span className="font-mono">
              {token.address.slice(0, 6)}…{token.address.slice(-4)}
            </span>
          )}
        </>
      ) : null}
    </span>
  );
}
