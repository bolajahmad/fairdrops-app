"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon } from "./icon";
import { Logo } from "./logo";
import { ThemeSwitch } from "./theme-switch";
import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";

const LINKS = [
  { href: "/", label: copy.discover },
  { href: "/me/prizes", label: copy.prizes },
  { href: "/me/wallet", label: copy.wallet },
  { href: "/host", label: copy.hosting },
  { href: "/developers", label: copy.developers },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={onNavigate}
          className={cn(
            "rounded-md px-3 py-2.5 font-semibold no-underline transition-colors",
            isActive(pathname, link.href)
              ? "bg-lagoon-soft text-lagoon-strong"
              : "text-ink hover:bg-surface-sunken",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Mobile: a slim top bar with a menu sheet. Desktop: a sidebar pinned to the left edge of the
 * screen at any width, with only the page content centred (at most 1120px wide) beside it.
 */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh w-full flex-col md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur md:hidden">
        <Link href="/" aria-label="FairDrops">
          <Logo size={24} />
        </Link>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger
            aria-label={copy.menu}
            className="grid size-10 place-items-center rounded-full bg-surface-sunken text-ink"
          >
            <Icon name="menu" />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-30 bg-ink/40" />
            <Dialog.Content className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-6 rounded-t-[var(--radius-xl)] bg-surface-raised px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[var(--lift)]">
              <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
              <Dialog.Title className="sr-only">{copy.menu}</Dialog.Title>
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
              <div className="flex flex-col gap-2">
                <span className="overline text-ink-muted">{copy.theme}</span>
                <ThemeSwitch />
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </header>

      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-line px-4 py-6 md:flex">
        <Link href="/" aria-label="FairDrops" className="px-3">
          <Logo size={28} />
        </Link>
        <NavLinks pathname={pathname} />
        <div className="mt-auto flex flex-col gap-2 px-1">
          <span className="overline text-ink-muted">{copy.theme}</span>
          <ThemeSwitch compact />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col px-4 py-6 md:px-10 md:py-10">
        <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}

/**
 * The screen's main action. On phones it is pinned to the bottom of the screen, full width,
 * within thumb reach. From tablet up it sits at the end of the content, aligned right.
 */
export function StickyBar({
  children,
  note,
  mobileOnly = false,
}: {
  children: ReactNode;
  note?: ReactNode;
  /** For screens that show the action in their header from tablet up. */
  mobileOnly?: boolean;
}) {
  return (
    <div
      className={cn(
        mobileOnly && "md:hidden",
        "sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col gap-2 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mx-0 md:mt-10 md:flex-row-reverse md:items-center md:justify-between md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none [&_.fd-bar-action]:w-full md:[&_.fd-bar-action]:w-auto md:[&_.fd-bar-action]:min-w-60",
      )}
    >
      {children}
      {note ? <p className="caption m-0 text-center text-ink-muted md:text-left">{note}</p> : null}
    </div>
  );
}
