"use client";

import { useRouter } from "next/navigation";
import { IconButton } from "./icon-button";
import { Logo } from "./logo";

export function AppBar({
  title,
  backHref,
  logo = false,
}: {
  title?: string;
  backHref?: string;
  logo?: boolean;
}) {
  const router = useRouter();
  return (
    <header className="flex flex-wrap items-center gap-3 px-4 py-3">
      {backHref ? (
        <IconButton
          icon="arrow"
          label="Back"
          className="rotate-180"
          onClick={() => router.push(backHref)}
        />
      ) : null}
      {logo ? <Logo size={28} /> : null}
      {title ? (
        <h1 className="title-m m-0 min-w-0 flex-1 truncate">{title}</h1>
      ) : (
        <span className="flex-1" />
      )}
    </header>
  );
}
