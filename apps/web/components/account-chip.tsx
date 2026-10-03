"use client";

import type { MeResponse } from "@fairdrops/shared";
import { Button } from "./button";
import { accountLabel } from "@/lib/account";
import { copy } from "@/lib/copy";

/** Who's signed in (a short address for a wallet, otherwise their name) and a way out. */
export function AccountChip({ me, onSignOut }: { me: MeResponse; onSignOut: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={`min-w-0 truncate rounded-full bg-surface-sunken px-3 py-1 text-xs ${
          me.login.method === "wallet" ? "font-mono" : "font-semibold"
        }`}
        title={me.login.method === "wallet" ? me.wallet : undefined}
      >
        {accountLabel(me)}
      </span>
      <Button size="sm" variant="ghost" onClick={onSignOut}>
        {copy.signIn.signOut}
      </Button>
    </div>
  );
}
