"use client";

import type { MeResponse } from "@fairdrops/shared";
import { useCallback, useEffect, useState } from "react";
import { friendlyError } from "./errors";
import { browserFairDrops } from "./fairdrops";
import {
  endSocialSession,
  startSocialSignIn,
  takeSocialError,
  type SocialProvider,
} from "./social";
import { connectedAccount, walletForSignIn } from "./wallet";

const listeners = new Set<() => void>();

/** Tells every `useAccount` to reload, e.g. after the Privy bridge signs someone in. */
export function accountChanged(): void {
  listeners.forEach((listener) => listener());
}

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

  const [version, setVersion] = useState(0);

  useEffect(() => {
    const reload = () => setVersion((n) => n + 1);
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, []);

  useEffect(() => {
    let live = true;
    browserFairDrops()
      .auth.me()
      .then((me) => live && setState({ status: "signedIn", me }))
      .catch(async () => {
        const wallet = await connectedAccount().catch(() => null);
        if (!live) return;
        setState({ status: "signedOut", wallet });
        const failed = takeSocialError();
        if (failed) {
          setError(failed);
          setBusy(false);
        }
      });
    return () => {
      live = false;
    };
  }, [version]);

  const signInWithWallet = useCallback(async (chainId = SIGN_IN_CHAIN) => {
    setBusy(true);
    setError(null);
    try {
      // A leftover social session would otherwise sign transactions for the wrong account.
      await endSocialSession();
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

  /** Leaves for the provider's sign-in; the Privy bridge finishes it when the page is back. */
  const signInWithSocial = useCallback(async (provider: SocialProvider) => {
    setBusy(true);
    setError(null);
    try {
      await startSocialSignIn(provider);
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't start signing in."));
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await browserFairDrops()
      .auth.signOut()
      .catch(() => {});
    await endSocialSession();
    setState({ status: "signedOut", wallet: await connectedAccount().catch(() => null) });
  }, []);

  return { state, busy, error, signInWithWallet, signInWithSocial, signOut };
}

const METHOD_NAMES: Record<MeResponse["login"]["method"], string> = {
  wallet: "Wallet",
  google: "Google",
  email: "Email",
  passkey: "Passkey",
};

/** Who's signed in: a short address for a wallet sign-in, otherwise their name. */
export function accountLabel(me: MeResponse): string {
  if (me.login.method === "wallet") return `${me.wallet.slice(0, 6)}…${me.wallet.slice(-4)}`;
  return me.login.handle ?? me.profile.displayName ?? METHOD_NAMES[me.login.method];
}
