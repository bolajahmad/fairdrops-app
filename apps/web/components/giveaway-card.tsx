import Link from "next/link";
import { Avatar, gameIconName } from "./avatar";
import { Countdown } from "./countdown";
import { Icon } from "./icon";
import { PrizeAmount } from "./prize-amount";
import { StatusChip } from "./status-chip";
import { TrustBadge } from "./trust-badge";
import type { GameKind, GiveawayCardProps } from "./types";

const GAME_NAMES: Record<GameKind, string> = {
  dice: "Dice",
  quiz: "Quiz",
  tap: "Tap Rush",
  custom: "Partner game",
};

export function GiveawayCard({ giveaway, href = "#", onClick }: GiveawayCardProps) {
  const game = giveaway.games[0];
  return (
    <Link
      href={href}
      onClick={onClick}
      className="group flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface-raised p-5 text-ink no-underline transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-line-strong"
    >
      <div className="flex items-center gap-2">
        <Avatar name={giveaway.host} hue={giveaway.hue} size={28} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-muted">
          {giveaway.host}
        </span>
        <StatusChip status={giveaway.status} />
      </div>
      <h3 className="title-m m-0 line-clamp-2 text-balance [overflow-wrap:anywhere]">
        {giveaway.title}
      </h3>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <PrizeAmount amount={giveaway.pool} symbol={giveaway.symbol} size="l" />
          <span className="caption shrink-0 text-ink-muted">
            {giveaway.winners} {giveaway.winners === 1 ? "winner" : "winners"}
          </span>
        </div>
        {giveaway.network || (giveaway.trust && giveaway.trust !== "verified") ? (
          <span className="caption flex flex-wrap items-center gap-2 text-ink-muted">
            {giveaway.network ? <span>on {giveaway.network}</span> : null}
            {giveaway.trust && giveaway.trust !== "verified" ? (
              <TrustBadge trust={giveaway.trust} />
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 border-t border-line pt-4 text-sm text-ink-muted">
        {game ? (
          <span className="inline-flex min-w-0 items-center gap-2">
            <span
              className={`inline-grid size-7 shrink-0 place-items-center rounded-sm text-on-stage stage-${game}`}
            >
              <Icon name={gameIconName(game)} size={14} />
            </span>
            <span className="truncate font-semibold text-ink">{GAME_NAMES[game]}</span>
          </span>
        ) : null}
        {giveaway.players ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="users" size={14} />
            {giveaway.players}
          </span>
        ) : null}
        {giveaway.seconds !== undefined &&
        (giveaway.status === "upcoming" ||
          giveaway.status === "live" ||
          giveaway.status === "ending") ? (
          <span className="ml-auto">
            <Countdown
              seconds={giveaway.seconds}
              running
              size="s"
              label={giveaway.status === "upcoming" ? "Starts in" : "Ends in"}
            />
          </span>
        ) : null}
      </div>
    </Link>
  );
}
