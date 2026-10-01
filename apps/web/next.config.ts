import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    "@fairdrops/sdk",
    "@fairdrops/shared",
    "@fairdrops/game-kit",
    "@fairdrops/settlement",
    "@fairdrops/contracts",
  ],
};

export default nextConfig;
