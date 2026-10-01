import { FairDrops } from "@fairdrops/sdk";

export function serverFairDrops(): FairDrops {
  return new FairDrops({
    apiUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  });
}

let browserClient: FairDrops | undefined;

export function browserFairDrops(): FairDrops {
  if (!browserClient) {
    browserClient = new FairDrops({
      apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
      transport: "cookie",
    });
  }
  return browserClient;
}

export function claimRelayEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CLAIM_RELAY_ENABLED !== "false";
}
