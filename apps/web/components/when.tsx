"use client";

import { formatWhen } from "@/lib/format";
import { useHydrated } from "@/lib/hydrated";

/** A date in the viewer's locale and time zone, rendered only in the browser. */
export function When({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  return <time dateTime={iso}>{hydrated ? formatWhen(iso) : ""}</time>;
}
