"use client";

import { Icon } from "./icon";
import { useBack } from "@/lib/back";
import { copy } from "@/lib/copy";

/**
 * The way back from a subpage, above its title. Goes back in history after in-app navigation
 * and reads "Back"; on a page opened directly it names and opens the parent page instead.
 */
export function BackLink({ fallback, label }: { fallback: string; label: string }) {
  const back = useBack(fallback);
  return (
    <button
      type="button"
      onClick={back.go}
      className="-ml-2 inline-flex min-h-10 cursor-pointer items-center gap-1.5 self-start rounded-full px-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      <Icon name="back" size={18} />
      {back.hasHistory ? copy.back : label}
    </button>
  );
}
