import { z } from "zod";

export const deploymentEnvironmentSchema = z.enum(["local", "testnet", "mainnet"]);
export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>;

export const chainSchema = z.object({
  chainId: z.number().int().positive(),
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  environment: deploymentEnvironmentSchema,
  nativeCurrency: z.object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    decimals: z.number().int().nonnegative(),
  }),
  rpcUrls: z.array(z.url()).min(1),
  blockExplorer: z.object({ name: z.string().min(1), url: z.url() }).nullable(),
  /** Blocks to wait before treating a log as final. */
  confirmations: z.number().int().nonnegative(),
});
export type Chain = z.infer<typeof chainSchema>;

export const chains = [
  {
    chainId: 31337,
    key: "anvil",
    name: "Anvil",
    environment: "local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["http://127.0.0.1:8545"],
    blockExplorer: null,
    confirmations: 0,
  },
  {
    chainId: 10143,
    key: "monad-testnet",
    name: "Monad Testnet",
    environment: "testnet",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: ["https://testnet-rpc.monad.xyz"],
    blockExplorer: { name: "Monadscan", url: "https://testnet.monadscan.com" },
    confirmations: 1,
  },
  {
    chainId: 11155111,
    key: "sepolia",
    name: "Sepolia",
    environment: "testnet",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    blockExplorer: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
    confirmations: 3,
  },
  {
    chainId: 84532,
    key: "base-sepolia",
    name: "Base Sepolia",
    environment: "testnet",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.base.org"],
    blockExplorer: { name: "Basescan", url: "https://sepolia.basescan.org" },
    confirmations: 2,
  },
  {
    chainId: 420420417,
    key: "polkadot-hub-testnet",
    name: "Polkadot Hub TestNet",
    environment: "testnet",
    nativeCurrency: { name: "Paseo", symbol: "PAS", decimals: 18 },
    rpcUrls: [
      "https://services.polkadothub-rpc.com/testnet",
      "https://eth-rpc-testnet.polkadot.io",
    ],
    blockExplorer: { name: "Blockscout", url: "https://blockscout-testnet.polkadot.io" },
    confirmations: 1,
  },
] as const satisfies readonly Chain[];

export type ChainId = (typeof chains)[number]["chainId"];

export function findChain(chainId: number): Chain | undefined {
  return chains.find((chain) => chain.chainId === chainId);
}

export function chainsInEnvironment(environment: DeploymentEnvironment): Chain[] {
  return chains.filter((chain) => chain.environment === environment);
}

export function explorerAddressUrl(chain: Chain, address: string): string | null {
  return chain.blockExplorer ? `${chain.blockExplorer.url}/address/${address}` : null;
}
