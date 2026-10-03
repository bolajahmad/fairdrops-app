"use client";

import { fairDropsChain } from "@fairdrops/sdk/host";
import {
  PrivyProvider,
  useLogin,
  useLoginWithOAuth,
  usePrivy,
  useSign7702Authorization,
  useWallets,
} from "@privy-io/react-auth";
import { useEffect, useState, type ReactNode } from "react";
import { accountChanged } from "@/lib/account";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import { isOAuth, registerSocial, reportSocialError, SOCIAL_PROVIDERS } from "@/lib/social";
import { hostChains } from "@/lib/tokens";
import { setAuthorizationSigner, setEmbeddedWallet } from "@/lib/wallet";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/**
 * Social sign-in with Privy, when this build has a Privy app. Privy only proves who someone is
 * and holds their embedded wallet; the FairDrops session (cookies, roles) still comes from our
 * API, which checks the Privy token itself.
 */
export function SocialSignIn({ children }: { children: ReactNode }) {
  if (!APP_ID) return children;
  const chains = hostChains().map((chain) => fairDropsChain(chain.chainId));
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: [...SOCIAL_PROVIDERS],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        supportedChains: chains,
        ...(chains[0] ? { defaultChain: chains[0] } : {}),
        appearance: { accentColor: "#087a70", walletChainType: "ethereum-only" },
      }}
    >
      <PrivyBridge />
      {children}
    </PrivyProvider>
  );
}

/**
 * Keeps Privy and the FairDrops session in step. Back from a provider's sign-in, it trades the
 * Privy token for a FairDrops session; while that session came from a social login, it hands
 * the embedded wallet to every action that signs something.
 */
function PrivyBridge() {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const { initOAuth } = useLoginWithOAuth({
    onError: (error) => {
      reportSocialError(friendlyError(error, "Couldn't sign you in."));
      accountChanged();
    },
  });
  // Email codes and passkeys run in Privy's own window, which also creates new accounts.
  const { login } = useLogin({
    onError: (error) => {
      // Closing the window isn't an error worth showing.
      if (String(error) !== "exited_auth_flow") {
        reportSocialError(friendlyError(error, "Couldn't sign you in."));
      }
      accountChanged();
    },
  });
  const { wallets } = useWallets();
  const { signAuthorization } = useSign7702Authorization();
  // Whether the current FairDrops session came from a social login.
  const [social, setSocial] = useState(false);

  useEffect(() => {
    registerSocial({
      start: async (provider) => {
        if (isOAuth(provider)) await initOAuth({ provider });
        else login({ loginMethods: [provider] });
      },
      end: logout,
    });
    return () => registerSocial(null);
  }, [initOAuth, login, logout]);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const fd = browserFairDrops();
    void (async () => {
      const me = await fd.auth.me().catch(() => null);
      if (me) {
        if (live) setSocial(me.login.method !== "wallet");
        return;
      }
      if (!authenticated) {
        if (live) setSocial(false);
        return;
      }
      const token = await getAccessToken();
      if (!token || !live) return;
      const signedIn = await fd.auth.signInWithPrivy(token);
      if (!live) return;
      setSocial(signedIn.login.method !== "wallet");
      accountChanged();
    })().catch((caught: unknown) => {
      reportSocialError(friendlyError(caught, "Couldn't sign you in."));
      accountChanged();
    });
    return () => {
      live = false;
    };
  }, [ready, authenticated, getAccessToken]);

  useEffect(() => {
    const wallet = wallets.find((candidate) => candidate.walletClientType === "privy");
    if (!social || !wallet) {
      setEmbeddedWallet(null);
      setAuthorizationSigner(null);
      return;
    }
    // The first gas-free action points the wallet at FairDrops' account contract (EIP-7702).
    // The relayer sends it, so the nonce is the wallet's own, as the API quoted it.
    setAuthorizationSigner(async ({ contractAddress, chainId, nonce }) => {
      const signed = await signAuthorization(
        { contractAddress, chainId, nonce },
        { address: wallet.address },
      );
      return {
        address: signed.address,
        chainId: signed.chainId,
        nonce: signed.nonce,
        r: signed.r,
        s: signed.s,
        yParity: signed.yParity,
      };
    });
    let live = true;
    void wallet
      .getEthereumProvider()
      .then((provider) => live && setEmbeddedWallet(provider))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [wallets, social, signAuthorization]);

  return null;
}
