"use client";

import { Button } from "./button";
import { ErrorNote } from "./error-note";
import { Icon } from "./icon";
import { copy } from "@/lib/copy";
import type { IconName } from "./types";

interface Method {
  id: string;
  label: string;
  icon: IconName;
  ready: boolean;
}

/** Google, email and passkeys need a wallet provider (Web3Auth) that is not configured yet. */
const METHODS: Method[] = [
  { id: "wallet", label: copy.signIn.wallet, icon: "wallet", ready: true },
  { id: "google", label: copy.continueGoogle, icon: "users", ready: false },
  { id: "email", label: copy.continueEmail, icon: "send", ready: false },
];

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
}: {
  title: string;
  reason: string;
  busy: boolean;
  error: string | null;
  onWallet: () => void;
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
      <div className="flex flex-col gap-3">
        {METHODS.map((method) => (
          <Button
            key={method.id}
            size="lg"
            block
            variant={method.ready ? "primary" : "secondary"}
            icon={method.icon}
            loading={method.ready && busy}
            disabled={!method.ready}
            onClick={method.ready ? onWallet : undefined}
          >
            {method.label}
          </Button>
        ))}
      </div>
      <p className="caption m-0 text-ink-muted">
        {copy.signIn.socialLater} {copy.signIn.note}
      </p>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </section>
  );
}
