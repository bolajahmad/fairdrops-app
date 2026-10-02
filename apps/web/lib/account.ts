"use client";

import type { MeResponse } from "@fairdrops/shared";
import { useCallback, useEffect, useState } from "react";
import { friendlyError } from "./errors";
import { browserFairDrops } from "./fairdrops";
import { connectedAccount, walletForSignIn } from "./wallet";

/** Base Sepolia: the chain the sign-in message names when the page has no chain of its own. */
const SIGN_IN_CHAIN = 84532;

export type AccountState =
  | { status: "loading" }
  /** `wallet`: a wallet already connected to this site, so sign-in is one signature. */
  | { status: "signedOut"; wallet: string | null }
  | { status: "signedIn"; me: MeResponse };

/** Who is signed in, and the ways to sign in or out. Sign-in only signs a message; no transaction. */
export function useAccount() {
  const [state, setState] = useState<AccountState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    browserFairDrops()
      .auth.me()
      .then((me) => live && setState({ status: "signedIn", me }))
      .catch(async () => {
        const wallet = await connectedAccount().catch(() => null);
        if (live) setState({ status: "signedOut", wallet });
      });
    return () => {
      live = false;
    };
  }, []);

  const signInWithWallet = useCallback(async (chainId = SIGN_IN_CHAIN) => {
    setBusy(true);
    setError(null);
    try {
      const wallet = await walletForSignIn(chainId);
      const me = await browserFairDrops().auth.signIn(wallet, { chainId, connector: "injected" });
      setState({ status: "signedIn", me });
      return me;
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't sign you in."));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await browserFairDrops()
      .auth.signOut()
      .catch(() => {});
    setState({ status: "signedOut", wallet: await connectedAccount().catch(() => null) });
  }, []);

  return { state, busy, error, signInWithWallet, signOut };
}
