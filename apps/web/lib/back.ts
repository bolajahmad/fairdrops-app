"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether this tab has moved between FairDrops pages since it loaded. A back control goes back in
 * history only then; on a page opened from a shared link it goes to the page's parent instead,
 * so "Back" never leaves FairDrops.
 */
let lastPath: string | null = null;
let moved = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mounted once in the root providers. Compares paths, so a re-run effect doesn't count. */
export function useTrackNavigation(): void {
  const pathname = usePathname();
  useEffect(() => {
    if (lastPath !== null && lastPath !== pathname && !moved) {
      moved = true;
      listeners.forEach((listener) => listener());
    }
    lastPath = pathname;
  }, [pathname]);
}

/** Back to the previous FairDrops page if there is one, otherwise to `fallback`. */
export function useBack(fallback: string): { hasHistory: boolean; go: () => void } {
  const router = useRouter();
  const hasHistory = useSyncExternalStore(
    subscribe,
    () => moved,
    () => false,
  );
  return {
    hasHistory,
    go: () => (hasHistory ? router.back() : router.push(fallback)),
  };
}
