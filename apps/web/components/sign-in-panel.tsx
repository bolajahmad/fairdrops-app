"use client";

import { ErrorNote } from "./error-note";
import { Icon } from "./icon";
import { SignInButtons } from "./social-buttons";
import { copy } from "@/lib/copy";
import { socialSignInEnabled, type SocialProvider } from "@/lib/social";

/**
 * The one sign-in block: a title saying why, the available methods, and errors in plain words.
 * Used wherever a page needs an account (Developers, Hosting, My prizes).
 */
export function SignInPanel({
  title,
  reason,
  busy,
  error,
  onWallet,
  onSocial,
}: {
  title: string;
  reason: string;
  busy: boolean;
  error: string | null;
  onWallet: () => void;
  onSocial: (provider: SocialProvider) => void;
}) {
  return (
    <section className="flex w-full max-w-[480px] flex-col gap-5 rounded-xl border border-line bg-surface-raised p-6">
      <div className="flex flex-col gap-1.5">
        <span className="grid size-11 place-items-center rounded-full bg-lagoon-soft text-lagoon-strong">
          <Icon name="lock" />
        </span>
        <h2 className="title-m m-0 mt-2">{title}</h2>
        <p className="m-0 text-ink-muted">{reason}</p>
      </div>
      <SignInButtons busy={busy} onSocial={onSocial} onWallet={onWallet} />
      <p className="caption m-0 text-ink-muted">
        {socialSignInEnabled ? copy.signIn.socialNote : copy.signIn.note}
      </p>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </section>
  );
}
