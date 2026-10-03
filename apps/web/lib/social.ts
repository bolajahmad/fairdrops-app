"use client";

/**
 * Sign-ins offered through Privy, by Privy's names. Google redirects to Google and back; email
 * (a one-time code) and passkeys finish in Privy's window on the page.
 */
export type SocialProvider = "google" | "email" | "passkey";

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ["google", "email", "passkey"];

export function isOAuth(provider: SocialProvider): provider is "google" {
  return provider === "google";
}

/** Whether this build has a Privy app; without one only wallet sign-in is offered. */
export const socialSignInEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

interface SocialControls {
  /** Starts the provider's sign-in; the page redirects there and back. */
  start: (provider: SocialProvider) => Promise<void>;
  /** Ends the Privy session, so it can't sign the person back in. */
  end: () => Promise<void>;
}

let controls: SocialControls | null = null;
let lastError: string | null = null;

/** A sign-in that failed after the redirect, shown by the next `useAccount`. */
export function reportSocialError(message: string): void {
  lastError = message;
}

export function takeSocialError(): string | null {
  const message = lastError;
  lastError = null;
  return message;
}

/** Called by the Privy bridge, the only place Privy's hooks are mounted. */
export function registerSocial(next: SocialControls | null): void {
  controls = next;
}

export async function startSocialSignIn(provider: SocialProvider): Promise<void> {
  if (!controls) throw new Error("Social sign-in isn't ready yet. Try again in a moment.");
  await controls.start(provider);
}

export async function endSocialSession(): Promise<void> {
  await controls?.end().catch(() => undefined);
}

/** Whether the page should finish a join once the person is back from signing in. */
const JOIN_INTENT = "fd:join-after-sign-in";

export function rememberJoinIntent(sessionId: string): void {
  try {
    sessionStorage.setItem(JOIN_INTENT, sessionId);
  } catch {
    // Private mode: the person taps Join again after signing in.
  }
}

/** The session someone was joining when they left to sign in, read once. */
export function takeJoinIntent(): string | null {
  try {
    const sessionId = sessionStorage.getItem(JOIN_INTENT);
    sessionStorage.removeItem(JOIN_INTENT);
    return sessionId;
  } catch {
    return null;
  }
}
