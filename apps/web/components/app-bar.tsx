"use client";

import { IconButton } from "./icon-button";
import { Logo } from "./logo";
import { useBack } from "@/lib/back";
import { copy } from "@/lib/copy";

export function AppBar({
  title,
  backHref,
  logo = false,
}: {
  title?: string;
  /** Shows a back button: back in history after in-app navigation, otherwise to this page. */
  backHref?: string;
  logo?: boolean;
}) {
  const back = useBack(backHref ?? "/");
  return (
    <header className="flex flex-wrap items-center gap-3 px-4 py-3">
      {backHref ? <IconButton icon="back" label={copy.back} onClick={back.go} /> : null}
      {logo ? <Logo size={28} /> : null}
      {title ? (
        <h1 className="title-m m-0 min-w-0 flex-1 truncate">{title}</h1>
      ) : (
        <span className="flex-1" />
      )}
    </header>
  );
}
