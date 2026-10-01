"use client";

import { useEffect, useState } from "react";
import { AppBar } from "@/components/app-bar";
import { ClaimCard } from "@/components/claim-card";
import { FairBadge } from "@/components/fair-badge";
import { Icon } from "@/components/icon";
import { LeaderboardRow } from "@/components/leaderboard-row";
import { StatusChip } from "@/components/status-chip";
import { copy } from "@/lib/copy";

const STEPS = ["Scores locked", "Checking every score", "Unlocking prizes"];

export default function PreviewResultsPage() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= 3) return;
    const timer = setTimeout(() => setStep(step + 1), 700);
    return () => clearTimeout(timer);
  }, [step]);
  const ready = step >= 3;

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col"
      data-play-beat={ready ? "results" : "settling"}
    >
      <AppBar title="Results" logo />
      <p className="caption px-4 text-ink-muted">{copy.previewNote}</p>
      <div className="flex flex-col gap-4 px-4 pb-8">
        {ready ? (
          <>
            <h1 className="display-l m-0">You finished #4</h1>
            <ol className="m-0 list-none p-0">
              <LeaderboardRow rank={1} name="Ada" score="12" prize="40" symbol="USDC" delay={0} />
              <LeaderboardRow rank={4} name="You" score="9" you delay={240} />
            </ol>
            <ClaimCard state="none" rank={4} winners={3} />
            <FairBadge state="pending" />
          </>
        ) : (
          <>
            <StatusChip status="settling" />
            <h1 className="display-l m-0">{"That's a wrap"}</h1>
            <ol className="m-0 list-none p-0">
              {STEPS.map((label, index) => (
                <li key={label} className="flex items-center gap-3 py-1">
                  {index < step ? (
                    <Icon name="check" size={16} />
                  ) : (
                    <Icon name="spinner" size={16} spin />
                  )}
                  {label}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
