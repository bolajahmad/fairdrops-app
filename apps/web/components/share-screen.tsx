"use client";

import type { GiveawayView, Hex } from "@fairdrops/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { Shell, StickyBar } from "@/components/shell";
import { browserFairDrops } from "@/lib/fairdrops";
import { formatTokenAmount, formatWhen, tokenDecimals, tokenSymbol } from "@/lib/format";

export function ShareScreen({
  chainId,
  giveawayId,
  title,
}: {
  chainId: string;
  giveawayId: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const [giveaway, setGiveaway] = useState<GiveawayView | null>(null);
  const path = `/g/${chainId}/${giveawayId}`;
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;

  useEffect(() => {
    let live = true;
    browserFairDrops()
      .giveaways.get(Number(chainId), giveawayId as Hex)
      .then((found) => live && setGiveaway(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [chainId, giveawayId]);

  const name = giveaway?.metadata?.title ?? title;
  const game = giveaway?.metadata?.game.id;
  const summary = giveaway
    ? `${formatTokenAmount(giveaway.prize, tokenDecimals(giveaway))} ${tokenSymbol(giveaway)} · starts ${formatWhen(giveaway.startTime)}`
    : "Players can join from this link.";
  const text = `Play ${name} on FairDrops and win a share of the prize`;

  function copy() {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-8">
        <header className="flex flex-col gap-2">
          <span className="overline text-lagoon">Your giveaway is live</span>
          <h1 className="display-l m-0">Now share it</h1>
          <p className="m-0 text-ink-muted">
            The more people see the link, the more people play. It can take a minute before it shows
            up for players.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface-raised p-4">
          <div className="relative flex h-36 gap-2">
            <span
              className={`flex-1 rounded-lg ${game === "quiz" ? "stage-quiz" : "stage-dice"}`}
            />
            <span className="stage-tap flex-1 rounded-lg" />
            <span className="absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-surface-raised shadow-[var(--lift)]">
              <Logo variant="mark" size={32} />
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-1 px-1">
            <span className="title-m truncate">{name}</span>
            <span className="caption text-ink-muted">{summary}</span>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <span className="label">Giveaway link</span>
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface-sunken py-1.5 pr-1.5 pl-3">
            <span className="mono-s min-w-0 flex-1 truncate">{url}</span>
            <Button size="sm" icon={copied ? "check" : undefined} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="secondary">WhatsApp</Button>
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="secondary">X</Button>
            </a>
            <Button
              variant="secondary"
              icon="share"
              onClick={() => {
                if (navigator.share)
                  void navigator.share({ title: name, text, url }).catch(() => {});
                else copy();
              }}
            >
              More
            </Button>
          </div>
        </section>

        <StickyBar>
          <Link href={`/host/${chainId}/${giveawayId}`} className="fd-bar-action">
            <Button size="lg" block variant="secondary" iconAfter="arrow">
              Manage giveaway
            </Button>
          </Link>
          <Link
            href="/host"
            className="hidden items-center gap-1 text-sm font-semibold text-ink-muted md:inline-flex"
          >
            <Icon name="back" size={16} /> All your giveaways
          </Link>
        </StickyBar>
      </div>
    </Shell>
  );
}
