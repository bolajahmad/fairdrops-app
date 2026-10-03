"use client";

import { KeyRound, Mail } from "lucide-react";
import { Button } from "./button";
import { copy } from "@/lib/copy";
import { socialSignInEnabled, type SocialProvider } from "@/lib/social";

const MAIN: readonly SocialProvider[] = ["google", "email", "passkey"];

const PATHS: Partial<Record<SocialProvider, string>> = {
  google:
    "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z",
};

/** A provider's mark, in the button's text colour. */
function Mark({ provider }: { provider: SocialProvider }) {
  if (provider === "email") return <Mail size={18} aria-hidden />;
  if (provider === "passkey") return <KeyRound size={18} aria-hidden />;
  const path = PATHS[provider];
  if (!path) return null;
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden>
      <path d={path} />
    </svg>
  );
}

/**
 * The ways in, social first: most players aren't crypto users, and a social sign-in comes
 * with a wallet they never have to think about. A wallet stays one tap away.
 */
export function SignInButtons({
  busy,
  onSocial,
  onWallet,
  walletLabel,
}: {
  busy: boolean;
  onSocial: (provider: SocialProvider) => void;
  onWallet: () => void;
  /** E.g. "Continue as 0x12…ab" when a browser wallet is already connected. */
  walletLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {socialSignInEnabled ? (
        <>
          {MAIN.map((provider, index) => (
            <Button
              key={provider}
              size="lg"
              block
              variant={index === 0 ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => onSocial(provider)}
            >
              <span className="inline-flex items-center gap-2">
                <Mark provider={provider} />
                {copy.signIn.continueWith[provider]}
              </span>
            </Button>
          ))}
        </>
      ) : null}
      <Button
        size="lg"
        block
        variant={socialSignInEnabled ? "ghost" : "primary"}
        icon="wallet"
        loading={busy}
        onClick={onWallet}
      >
        {walletLabel ?? (socialSignInEnabled ? copy.signIn.useWallet : copy.signIn.wallet)}
      </Button>
    </div>
  );
}
