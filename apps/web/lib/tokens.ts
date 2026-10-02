import {
  explorerAddressUrl,
  findApprovedToken,
  findChain,
  hostableChains,
  toTokenView,
  type Chain,
  type DeploymentEnvironment,
  type TokenView,
} from "@fairdrops/shared";
import { formatUnits } from "viem";

const ENVIRONMENT = (process.env.NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT ??
  "testnet") as DeploymentEnvironment;

/** Chains a host can create a giveaway on here: deployed and indexed. */
export function hostChains(): Chain[] {
  return hostableChains(ENVIRONMENT);
}

/** USDC on Base Sepolia: most hosts think in dollars. Falls back to the first hostable native token. */
export function defaultPrizeToken(): TokenView {
  const usdc = findApprovedToken(84532, "0x036cbd53842c5426634e7929541ec2318f3dcf7e");
  if (usdc && hostChains().some((chain) => chain.chainId === usdc.chainId))
    return toTokenView(usdc);
  const chain = hostChains()[0] ?? findChain(84532)!;
  return toTokenView(
    findApprovedToken(chain.chainId, "0x0000000000000000000000000000000000000000")!,
  );
}

export const tokenKey = (token: { chainId: number; address: string }) =>
  `${token.chainId}:${token.address.toLowerCase()}`;

export function chainName(chainId: number): string {
  return findChain(chainId)?.name ?? `Chain ${chainId}`;
}

export function tokenExplorerUrl(
  token: Pick<TokenView, "chainId" | "address" | "native">,
): string | null {
  if (token.native) return null;
  const chain = findChain(token.chainId);
  return chain ? explorerAddressUrl(chain, token.address) : null;
}

/** For reading only: grouped for the viewer's locale, at most `digits` decimals, never rounded up. */
export function displayUnits(value: bigint, decimals: number, digits = 4): string {
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const grouped = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    BigInt(whole),
  );
  const kept = fraction.slice(0, digits).replace(/0+$/, "");
  return kept ? `${grouped}.${kept}` : grouped;
}
