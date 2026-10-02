"use client";

import { useEffect, useState } from "react";
import { IconButton } from "./icon-button";

/**
 * One icon for sharing a giveaway: the device's share sheet where there is one (phones), or a
 * copied link elsewhere, confirmed in the button's label.
 */
export function ShareButton({ path, title }: { path: string; title: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function share() {
    const url = new URL(path, window.location.origin).toString();
    if (typeof navigator.share === "function") {
      // Dismissing the sheet rejects; that's not an error worth showing.
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard
      .writeText(url)
      .then(() => setCopied(true))
      .catch(() => undefined);
  }

  return (
    <IconButton
      icon={copied ? "check" : "share"}
      label={copied ? "Link copied" : "Share the giveaway"}
      pressed={copied}
      onClick={() => void share()}
    />
  );
}
