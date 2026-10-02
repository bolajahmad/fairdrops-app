"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while rendering on the server and hydrating, true after. Anything formatted for the
 * viewer's locale or time zone (dates, "in 2 hours") must wait for it: the server's locale and
 * zone aren't the viewer's, and a mismatch breaks hydration.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
