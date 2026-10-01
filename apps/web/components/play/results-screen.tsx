"use client";

import type { Address, ClaimView, SessionView, SettlementView } from "@fairdrops/shared";
import { FairDropsError } from "@fairdrops/sdk";
import { claimPrize } from "@fairdrops/sdk/claims";
import { verifyGiveaway, type GiveawayVerification } from "@fairdrops/sdk/verify";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppBar } from "@/components/app-bar";
import { Button } from "@/components/button";
import { ClaimCard } from "@/components/claim-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorNote } from "@/components/error-note";
import { FairBadge } from "@/components/fair-badge";
import { Icon } from "@/components/icon";
import { LeaderboardRow } from "@/components/leaderboard-row";
import { StatusChip } from "@/components/status-chip";
import { cn } from "@/lib/cn";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops, claimRelayEnabled } from "@/lib/fairdrops";
import { formatTokenAmount, formatWhen, shortenWallet } from "@/lib/format";
import { playBlip } from "@/lib/sound";
import { connectInjectedWallet } from "@/lib/wallet";

const RELAY_WAIT_MS = 120_000;
const STEPS = ["Scores locked", "Checking every score", "Unlocking prizes"];
const PLAYING = new Set(["SCHEDULED", "SEED_COMMITTED", "LOBBY", "RUNNING"]);

/** The four things a player cares about, each backed by one or more SDK checks. */
const CHECK_GROUPS: { label: string; detail: string; names: string[] }[] = [
  {
    label: "Every score replayed",
    detail: "The game log was replayed from the committed seed and gave the same scores.",
    names: ["transcript", "transcriptHash", "seed", "game"],
  },
  {
    label: "Winners match the leaderboard",
    detail: "The people paid are the people at the top of the board.",
    names: ["result", "giveaway"],
  },
  {
    label: "Prize split matches the host's",
    detail: "Each place got exactly what the giveaway promised.",
    names: ["payouts", "metadata"],
  },
  {
    label: "Payment recorded publicly",
    detail: "The payout list was signed by independent checkers and recorded on-chain.",
    names: ["payoutTree"],
  },
];

/** Settlement progress from the real pipeline, never a timer. */
function settleStep(session: SessionView, settlement: SettlementView | null): number {
  if (!settlement) return session.status === "SETTLING" ? 0 : 1;
  if (settlement.status === "SUBMITTED" || session.status === "FINALIZING") return 2;
  return 1;
}

export function ResultsScreen({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [settlement, setSettlement] = useState<SettlementView | null>(null);
  const [claim, setClaim] = useState<ClaimView | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [waited, setWaited] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const fd = browserFairDrops();
      const user = await fd.auth.me().catch(() => null);
      if (!cancel) setMe(user?.wallet ?? null);
      try {
        const loaded = await fd.sessions.get(sessionId);
        if (cancel) return;
        setSession(loaded);
        setLoadError(null);
        if (["FINALIZED", "SETTLING", "FINALIZING"].includes(loaded.status)) {
          try {
            const next = await fd.settlement.get(sessionId);
            if (!cancel) setSettlement(next);
          } catch (caught) {
            if (!(caught instanceof FairDropsError) || caught.code !== "NOT_FOUND") throw caught;
          }
        }
      } catch (caught) {
        if (!cancel) setLoadError(friendlyError(caught, "Results aren't available right now."));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [sessionId, attempt]);

  useEffect(() => {
    if (session?.status === "FINALIZED") playBlip(880);
  }, [session?.status]);

  useEffect(() => {
    if (seenAt === null) return;
    const started = seenAt;
    const timer = setInterval(() => setWaited(Date.now() - started), 1000);
    return () => clearInterval(timer);
  }, [seenAt]);

  const mine =
    me && settlement ? settlement.payouts.find((payout) => payout.account === me) : undefined;

  useEffect(() => {
    if (!session || !me || !mine) return;
    let cancel = false;
    browserFairDrops()
      .claims.get(session.chainId, session.giveawayId, me as Address)
      .then((next) => {
        if (cancel) return;
        setClaim(next);
        setSeenAt((current) => current ?? Date.now());
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [session, me, mine]);

  if (!session) {
    return (
      <Frame>
        {loadError ? (
          <EmptyState
            icon="alert"
            title="We couldn't load the results"
            action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
          >
            {loadError}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3" aria-busy>
            <div className="h-10 w-2/3 animate-pulse rounded-md bg-surface-sunken" />
            <div className="h-40 animate-pulse rounded-lg bg-surface-sunken" />
          </div>
        )}
      </Frame>
    );
  }

  const giveawayHref = `/g/${session.chainId}/${session.giveawayId}`;

  if (session.status === "CANCELLED" || session.status === "FAILED") {
    return (
      <Frame>
        <EmptyState
          icon="alert"
          title={
            session.status === "CANCELLED"
              ? "This giveaway was cancelled"
              : "This game didn't produce a result"
          }
          action={
            <Link href={giveawayHref}>
              <Button variant="secondary">Back to the giveaway</Button>
            </Link>
          }
        >
          {session.status === "CANCELLED"
            ? "The host cancelled it before it finished. The prize went back to them, and nobody was charged anything."
            : "Something stopped the game from finishing, so nobody was paid and the host gets the prize back. Nothing was taken from players."}
        </EmptyState>
      </Frame>
    );
  }

  if (PLAYING.has(session.status)) {
    return (
      <Frame>
        <EmptyState
          icon="clock"
          title="The game isn't over yet"
          action={
            <Link href={`/play/${session.id}`}>
              <Button>Go to the game</Button>
            </Link>
          }
        >
          Results appear here once everyone has played and the scores are checked.
        </EmptyState>
      </Frame>
    );
  }

  if (session.status !== "FINALIZED") {
    const step = settleStep(session, settlement);
    return (
      <Frame>
        <div className="flex flex-col gap-6">
          <StatusChip status="settling" />
          <div className="flex flex-col gap-2">
            <h1 className="display-l m-0">That&apos;s a wrap</h1>
            <p className="body-l m-0 text-ink-muted">
              We&apos;re checking every score before anyone is paid. This usually takes a minute or
              two, and you can leave this page and come back.
            </p>
          </div>
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {STEPS.map((label, index) => (
              <li
                key={label}
                className={cn(
                  "flex items-center gap-3 font-semibold",
                  index > step ? "text-ink-muted" : "text-ink",
                )}
              >
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full border-2",
                    index < step
                      ? "border-lagoon bg-lagoon text-on-lagoon"
                      : index === step
                        ? "border-lagoon text-lagoon"
                        : "border-line-strong",
                  )}
                >
                  {index < step ? (
                    <Icon name="check" size={16} />
                  ) : index === step ? (
                    <Icon name="spinner" size={16} spin />
                  ) : null}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </div>
      </Frame>
    );
  }

  const won = Boolean(mine && BigInt(mine.amount) > 0n);
  const claimed = Boolean(claim?.claimedAt);
  const relay = claimRelayEnabled();
  const state = claimState({
    won,
    claimed,
    relay,
    waited,
    claimable: Boolean(claim?.claimable),
  });
  const myRow = session.ranking?.find((row) => row.player === me);
  const decimals = claim?.tokenInfo?.decimals ?? 18;
  const payoutOf = (player: string) =>
    settlement?.payouts.find((payout) => payout.account === player)?.amount;

  return (
    <Frame
      title="Results"
      sticky={
        <ClaimCard
          state={collecting ? "collecting" : state}
          rank={mine?.rank ?? myRow?.rank}
          amount={mine ? formatTokenAmount(mine.amount, decimals) : undefined}
          symbol={claim?.tokenInfo?.symbol}
          deadline={claim?.claimDeadline ? formatWhen(claim.claimDeadline) : undefined}
          winners={settlement?.winnerCount}
          onCollect={() => {
            if (!claim) return;
            setCollecting(true);
            setActionError(null);
            void connectInjectedWallet(claim.chainId)
              .then((wallet) => claimPrize(wallet, claim))
              .then(() => setClaim({ ...claim, claimedAt: new Date().toISOString() }))
              .catch((caught: unknown) =>
                setActionError(friendlyError(caught, "The prize wasn't collected. Try again.")),
              )
              .finally(() => setCollecting(false));
          }}
          onShare={() => {
            const url = window.location.href;
            if (navigator.share) void navigator.share({ title: "FairDrops", url }).catch(() => {});
            else void navigator.clipboard?.writeText(url).catch(() => {});
          }}
        />
      }
    >
      <div className="flex flex-col gap-6">
        {myRow ? (
          <div className="motion-pop flex flex-col items-center gap-1 py-4 text-center">
            <span className="overline text-lagoon">You placed</span>
            <span className="font-display text-[96px] leading-[0.95] font-extrabold tracking-[-0.04em] text-lagoon">
              #{myRow.rank}
            </span>
            <span className="text-ink-muted">
              out of {session.playerCount} {session.playerCount === 1 ? "player" : "players"}
            </span>
          </div>
        ) : (
          <h1 className="display-l m-0">The final board</h1>
        )}
        <ol className="m-0 list-none p-0">
          {(session.ranking ?? []).map((row, index) => {
            const amount = payoutOf(row.player);
            return (
              <LeaderboardRow
                key={row.player}
                rank={row.rank}
                name={row.player === me ? "You" : shortenWallet(row.player)}
                score={String(row.score)}
                prize={amount ? formatTokenAmount(amount, decimals) : undefined}
                symbol={claim?.tokenInfo?.symbol}
                you={row.player === me}
                delay={index * 80}
              />
            );
          })}
        </ol>
        <div className="flex justify-center">
          <FairBadge state="verified" label="How we checked" href={`${giveawayHref}/verify`} />
        </div>
        {actionError ? <ErrorNote>{actionError}</ErrorNote> : null}
      </div>
    </Frame>
  );
}

/** Play-flow page frame: app bar, a centred 480px column, an optional sticky bottom area. */
function Frame({
  title,
  sticky,
  children,
}: {
  title?: string;
  sticky?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <AppBar title={title} logo={!title} />
      <main className="flex flex-1 flex-col px-4 pt-2 pb-8">{children}</main>
      {sticky ? (
        <div className="sticky bottom-0 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
          {sticky}
        </div>
      ) : null}
    </div>
  );
}

function claimState(input: {
  won: boolean;
  claimed: boolean;
  relay: boolean;
  waited: number;
  claimable: boolean;
}): "waiting" | "ready" | "collecting" | "collected" | "expired" | "none" {
  if (!input.won) return "none";
  if (input.claimed) return "collected";
  if (input.relay && input.waited < RELAY_WAIT_MS) return "collecting";
  if (input.claimable || !input.relay || input.waited >= RELAY_WAIT_MS) return "ready";
  return "waiting";
}

export function VerifyScreen({
  chainId,
  giveawayId,
}: {
  chainId: number;
  giveawayId: `0x${string}`;
}) {
  const [report, setReport] = useState<GiveawayVerification | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    const fd = browserFairDrops();
    fd.giveaways
      .get(chainId, giveawayId)
      .then(async (giveaway) => {
        if (giveaway.phase !== "claimable" && giveaway.phase !== "closed") {
          if (!cancel) setNotReady(true);
          return;
        }
        const next = await verifyGiveaway(fd, chainId, giveawayId);
        if (!cancel) setReport(next);
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(friendlyError(caught, "The check couldn't run."));
      });
    return () => {
      cancel = true;
    };
  }, [chainId, giveawayId, attempt]);

  const back = `/g/${chainId}/${giveawayId}`;
  const state = report
    ? report.ok
      ? "verified"
      : "failed"
    : notReady || error
      ? "pending"
      : "checking";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <AppBar title="How we checked" backHref={back} />
      <main className="flex flex-col gap-6 px-4 pt-2 pb-10">
        <FairBadge state={state} label={notReady ? "Checked after the game" : undefined} />

        {notReady ? (
          <EmptyState icon="clock" title="Results aren't in yet">
            Once the game ends and the scores are settled, this page checks the result right here in
            your browser. Come back after the game.
          </EmptyState>
        ) : null}

        {error ? (
          <ErrorNote
            action={
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                onClick={() => {
                  setError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </Button>
            }
          >
            {error} This doesn&apos;t mean anything is wrong with the result.
          </ErrorNote>
        ) : null}

        {report || (!notReady && !error) ? (
          <>
            <p className="body-l m-0 text-ink">
              This check runs on your device. You don&apos;t have to take our word for it.
            </p>
            <ol className="m-0 flex list-none flex-col gap-4 p-0">
              {CHECK_GROUPS.map((group) => {
                const found =
                  report?.checks.filter((check) => group.names.includes(check.name)) ?? [];
                const ok = report ? found.every((check) => check.ok) : null;
                const failedDetail = found.find((check) => !check.ok)?.detail;
                return (
                  <li key={group.label} className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
                        ok === null
                          ? "border-2 border-lagoon text-lagoon"
                          : ok
                            ? "bg-lagoon text-on-lagoon"
                            : "bg-danger text-on-danger",
                      )}
                    >
                      <Icon
                        name={ok === null ? "spinner" : ok ? "check" : "x"}
                        size={14}
                        spin={ok === null}
                      />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold">{group.label}</span>
                      <span
                        className={cn(
                          "caption [overflow-wrap:anywhere]",
                          ok === false ? "text-danger" : "text-ink-muted",
                        )}
                      >
                        {ok === false && failedDetail ? failedDetail : group.detail}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}

        {report ? (
          <section className="rounded-lg border border-line bg-surface-raised">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left font-semibold"
            >
              <span className="flex items-center gap-2">
                <Icon name="lock" size={18} />
                Technical proof
              </span>
              <Icon name="chevron" className={cn("transition-transform", open && "rotate-180")} />
            </button>
            {open ? (
              <dl className="m-0 grid gap-x-4 gap-y-3 border-t border-line p-4 sm:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="caption text-ink-muted">Checked against</dt>
                <dd className="m-0 font-mono text-[13px]">
                  {report.against === "onchain" ? "The contract's record" : "The signed proposal"}
                </dd>
                {report.checks.map((check) => (
                  <div key={`${check.name}-${check.detail}`} className="contents">
                    <dt className="caption text-ink-muted">{check.name}</dt>
                    <dd className="m-0 font-mono text-[13px] [overflow-wrap:anywhere]">
                      {check.ok ? "✓ " : "✗ "}
                      {check.detail}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
