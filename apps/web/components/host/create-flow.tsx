"use client";

import { gameDefinitionViewSchema, pageSchema, type GameDefinitionView } from "@fairdrops/shared";
import { createGiveaway, prepareGiveaway } from "@fairdrops/sdk/host";
import { formatUnits, parseUnits } from "viem";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import { ErrorNote } from "@/components/error-note";
import { Field } from "@/components/field";
import { Icon } from "@/components/icon";
import { Segmented } from "@/components/segmented";
import { StickyBar } from "@/components/shell";
import { cn } from "@/lib/cn";
import { copy, create } from "@/lib/copy";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";
import { formatWhen, placeAmounts } from "@/lib/format";
import {
  audiencePresets,
  randomBps,
  rewardPolicy,
  startFromChoice,
  type AudienceId,
  type GameChoice,
  type PlayMode,
  DEFAULT_MAX_WINS,
  DEFAULT_ROUND_BREAK_SECONDS,
  DEFAULT_PLAY_MINUTES,
  PLAY_TIMES,
  playTimeLabel,
  type PlayMinutes,
  type RewardMode,
  type StartChoice,
  eveningSlot,
  toLocalInput,
} from "@/lib/presets";
import { TokenFacts } from "@/components/token-facts";
import { TokenAvatar } from "@/components/token-avatar";
import { TokenPicker } from "@/components/host/token-picker";
import {
  chainName,
  defaultPrizeToken,
  displayUnits,
  tokenExplorerUrl,
  tokenKey,
} from "@/lib/tokens";
import {
  connectInjectedWallet,
  connectedAccount,
  onWalletChainChange,
  requestAccount,
  walletChainId,
} from "@/lib/wallet";
import { balancesOf } from "@fairdrops/sdk/host";
import type { Address, QuizBankView, TokenView } from "@fairdrops/shared";
import { DEFAULT_QUIZ_BANK_HASH, findHostedGame, roundCount, rounds } from "@fairdrops/game-kit";

const STEPS = 3;
const MAX_WINNERS = 50;
const BUILT_IN = [
  { id: "dice", name: "Dice", icon: "dice" },
  { id: "quiz", name: "Quiz", icon: "quiz" },
] as const;

interface GameRef {
  id: string;
  version: string;
  name: string;
  external: boolean;
}

export function CreateFlow() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [audience, setAudience] = useState<AudienceId>("community");
  const preset = audiencePresets.find((item) => item.id === audience) ?? audiencePresets[0]!;
  const [title, setTitle] = useState("Friday night drop");
  const [pool, setPool] = useState(preset.pool);
  // The whole token travels through the flow, so its chain, symbol and decimals never get lost.
  const [token, setToken] = useState<TokenView>(defaultPrizeToken);
  const [picking, setPicking] = useState(false);
  const [owner, setOwner] = useState<Address | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [steps, setSteps] = useState<LockSteps | null>(null);
  const [winners, setWinners] = useState(preset.winners);
  const [reward, setReward] = useState<RewardMode>(preset.reward);
  const [drawn, setDrawn] = useState<number[]>(() => randomBps(preset.winners));
  const [gameChoice, setGameChoice] = useState<GameChoice>("auto");
  // In round order: with rounds, round r plays gameKeys[r % gameKeys.length].
  const [gameKeys, setGameKeys] = useState<string[]>(["dice@1.0.0"]);
  const [playMode, setPlayMode] = useState<PlayMode>("once");
  const [perRound, setPerRound] = useState(3);
  const [maxWins, setMaxWins] = useState(DEFAULT_MAX_WINS);
  const [breakSeconds, setBreakSeconds] = useState(String(DEFAULT_ROUND_BREAK_SECONDS));
  const [playMinutes, setPlayMinutes] = useState<PlayMinutes>(DEFAULT_PLAY_MINUTES);
  const [when, setWhen] = useState<StartChoice>(preset.when);
  const [picked, setPicked] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
  // Re-rendered every minute so "In 15 min" and the evening slot stay true while the form is open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const [rolls, setRolls] = useState("3");
  const [windowSeconds, setWindowSeconds] = useState("120");
  // Quizzes draw from FairDrops' own 100-question bank unless the host picks another.
  const [bank, setBank] = useState<string>(DEFAULT_QUIZ_BANK_HASH);
  const [banks, setBanks] = useState<QuizBankView[]>([]);
  const [questions, setQuestions] = useState("10");
  const [secondsPerQuestion, setSecondsPerQuestion] = useState("15");
  const [minScore, setMinScore] = useState("1");

  const [pay, setPay] = useState("wallet");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [externalGames, setExternalGames] = useState<GameDefinitionView[]>([]);

  useEffect(() => {
    let live = true;
    connectedAccount()
      .then((account) => live && setOwner(account))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!owner) return;
    let live = true;
    balancesOf(owner, [token])
      .then((found) => live && setBalance(found.get(tokenKey(token)) ?? null))
      .catch(() => live && setBalance(null));
    return () => {
      live = false;
    };
  }, [owner, token]);

  // Which network the wallet is on, kept live, so Review can say what will happen before it does.
  useEffect(() => {
    let live = true;
    walletChainId()
      .then((id) => live && setWalletChain(id))
      .catch(() => {});
    const stop = onWalletChainChange((id) => setWalletChain(id));
    return () => {
      live = false;
      stop();
    };
  }, []);

  async function connect() {
    try {
      setOwner(await requestAccount());
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't connect your wallet."));
    }
  }

  useEffect(() => {
    let live = true;
    browserFairDrops()
      .games.quizBanks()
      .then((found) => live && setBanks(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    browserFairDrops()
      .http.get("/games", { schema: pageSchema(gameDefinitionViewSchema), auth: "none" })
      .then((page) => {
        if (live) setExternalGames(page.items.filter((game) => game.mode === "EXTERNAL"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  function applyPreset(id: string) {
    const next = audiencePresets.find((item) => item.id === id);
    if (!next) return;
    setAudience(next.id);
    setPool(next.pool);
    setWinners(next.winners);
    setReward(next.reward);
    setWhen(next.when);
    setDrawn(randomBps(next.winners));
  }

  function changeWinners(next: number) {
    const value = Math.min(MAX_WINNERS, Math.max(1, next));
    setWinners(value);
    setDrawn(randomBps(value));
  }

  const games: GameRef[] = [
    ...BUILT_IN.map((game) => ({
      id: game.id,
      version: "1.0.0",
      name: game.name,
      external: false,
    })),
    ...externalGames.map((game) => ({
      id: game.id,
      version: game.version,
      name: game.name,
      external: true,
    })),
  ];
  const keyOf = (item: GameRef) => `${item.id}@${item.version}`;
  const chosen =
    gameChoice === "auto"
      ? [games[0]!]
      : gameKeys.flatMap((key) => games.filter((item) => keyOf(item) === key));
  const lineup = chosen.length > 0 ? chosen : [games[0]!];
  const game = lineup[0]!;
  // External games report their own scores, so they can't take turns in rounds.
  const roundsAllowed = !game.external;
  const inRounds = roundsAllowed && (playMode === "rounds" || lineup.length > 1);
  const roundWinners = Math.min(perRound, winners);
  const winLimit = maxWins >= winners ? null : maxWins;
  const gameNames = lineup.map((item) => item.name).join(" → ");

  const amount = parseAmount(pool, token.decimals);
  const policy = { ...rewardPolicy(reward, winners, drawn), minScore: Number(minScore) || 1 };
  const places = amount > 0n ? placeAmounts(amount, policy) : [];
  const fmt = (value: bigint) => `${displayUnits(value, token.decimals)} ${token.symbol}`;
  const acknowledged = token.trust === "verified" || ackFor === tokenKey(token);
  const overBalance = balance !== null && amount > balance;
  const start = startFromChoice(when, picked, now);
  const evening = eveningSlot(now);
  const configOf = (item: GameRef): Record<string, unknown> =>
    item.id === "quiz" && !item.external
      ? {
          bank,
          questions: Number(questions),
          secondsPerQuestion: Number(secondsPerQuestion),
          revealSeconds: 3,
        }
      : item.id === "dice" && !item.external
        ? { rolls: Number(rolls), dice: 2, sides: 6, windowSeconds: Number(windowSeconds) }
        : {};
  const choiceOf = (item: GameRef) => ({
    id: item.id,
    version: item.version,
    config: configOf(item),
  });
  const roundsSettings = inRounds
    ? {
        winnersPerRound: roundWinners,
        playSeconds: playMinutes * 60,
        cooldownSeconds: Number(breakSeconds) || DEFAULT_ROUND_BREAK_SECONDS,
        ...(winLimit === null ? {} : { maxWinsPerPlayer: winLimit }),
        next: lineup.slice(1).map(choiceOf),
      }
    : null;
  // Rounds that fit in the play time, from the same schedule the game will run.
  const roundsPlanned = roundsSettings
    ? plannedRounds(
        { ...roundsSettings, games: [choiceOf(game), ...roundsSettings.next] },
        winners,
        Number(minScore) || 1,
      )
    : 0;
  const playTime = playTimeLabel(playMinutes);
  const prepared = buildGiveaway({
    chainId: token.chainId,
    token: token.address,
    amount,
    startTime: start,
    // A day to settle after play ends. Rounds play for the host's play time first.
    finalizeDeadline: new Date(
      start.getTime() + (inRounds ? playMinutes * 60 * 1000 : 0) + 24 * 60 * 60 * 1000,
    ),
    maxWinners: winners,
    metadata: {
      v: 2,
      title: title.trim() || "Giveaway",
      description: "",
      game: choiceOf(game),
      rewards: policy,
      ...(roundsSettings ? { rounds: roundsSettings } : {}),
    },
  });

  const hasQuiz = lineup.some((item) => item.id === "quiz" && !item.external);
  const hasDice = lineup.some((item) => item.id === "dice" && !item.external);

  async function lock() {
    if (hasQuiz && !/^0x[0-9a-f]{64}$/.test(bank)) {
      setError(create.review.needBank);
      return;
    }
    if (prepared instanceof Error) {
      setError(prepared.message);
      return;
    }
    setBusy(true);
    setError(null);
    // The wallet is asked, in order: connect (if needed), switch network (if needed), allow the
    // token (ERC-20s, if the allowance is short), lock. Each step shows here as it happens.
    setSteps({
      network: walletChain === token.chainId ? "skipped" : "signing",
      approve: token.native ? "skipped" : "pending",
      lock: "pending",
    });
    const mark = (step: keyof LockSteps, status: StepStatus) =>
      setSteps((current) => (current ? { ...current, [step]: status } : current));
    try {
      const wallet = await connectInjectedWallet(token.chainId);
      setSteps((current) =>
        current && current.network === "signing" ? { ...current, network: "done" } : current,
      );
      const { giveawayId } = await createGiveaway(wallet, prepared, {
        onProgress: (progress) => mark(progress.step, progress.status),
      });
      router.push(`/host/${token.chainId}/${giveawayId}/share?title=${encodeURIComponent(title)}`);
    } catch (caught) {
      setSteps((current) => {
        if (!current) return current;
        const failed = (Object.keys(current) as (keyof LockSteps)[]).find(
          (step) => current[step] === "signing" || current[step] === "confirming",
        );
        return failed ? { ...current, [failed]: "failed" } : current;
      });
      setError(friendlyError(caught, "Nothing was locked. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function back() {
    setError(null);
    if (step === 0) router.push("/host");
    else setStep(step - 1);
  }

  const gameDescription =
    gameChoice === "auto"
      ? create.games.describeAuto
      : game.external
        ? create.games.describeExternal(game.name)
        : lineup.map((item) => create.games.describe[item.id] ?? "").join(" ");
  const rewardDescription =
    reward === "balanced"
      ? create.reward.describeBalanced(winners, places[0] ? fmt(places[0]) : `0 ${token.symbol}`)
      : reward === "weighted"
        ? create.reward.describeWeighted(
            winners,
            places[0] ? fmt(places[0]) : "",
            places.at(-1) ? fmt(places.at(-1)!) : "",
          )
        : create.reward.describeRandom(winners);

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col">
      <StepHeader step={step} onBack={back} />

      <div className="flex flex-col gap-10 pt-8">
        {step === 0 ? (
          <Section heading={create.audience.heading} lead={create.audience.lead} large>
            <Segmented
              stacked
              label={create.audience.heading}
              value={audience}
              onChange={applyPreset}
              options={[
                { value: "community", icon: "users", ...create.audience.community },
                { value: "followers", icon: "share", ...create.audience.followers },
                { value: "custom", icon: "sparkles", ...create.audience.custom },
              ]}
            />
          </Section>
        ) : null}

        {step === 1 ? (
          <>
            <Section heading={create.prize.heading} large>
              <Field
                label={create.prize.name}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <PrizeInput
                token={token}
                value={pool}
                onChange={setPool}
                balance={balance}
                over={overBalance}
                onPick={() => setPicking(true)}
              />
              {token.trust !== "verified" ? (
                <UnverifiedNotice
                  token={token}
                  checked={ackFor === tokenKey(token)}
                  onCheck={(on) => setAckFor(on ? tokenKey(token) : null)}
                />
              ) : null}
              <div className="flex items-center justify-between gap-4">
                <span className="label">{create.prize.winners}</span>
                <Stepper value={winners} onChange={changeWinners} />
              </div>
            </Section>

            <Section heading={create.reward.heading}>
              <Segmented
                label={create.reward.heading}
                value={reward}
                onChange={(value) => setReward(value as RewardMode)}
                options={[
                  { value: "balanced", icon: "scale", label: create.reward.balanced.label },
                  { value: "weighted", icon: "trophy", label: create.reward.weighted.label },
                  { value: "random", icon: "shuffle", label: create.reward.random.label },
                ]}
              />
              <Explainer>{rewardDescription}</Explainer>
              <PlacesPreview places={places} format={fmt} />
              {reward === "random" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="shuffle"
                  className="self-start"
                  onClick={() => setDrawn(randomBps(winners))}
                >
                  {create.reward.reshuffle}
                </Button>
              ) : null}
            </Section>

            <Section heading={create.games.heading}>
              <Segmented
                stacked
                label={create.games.heading}
                value={gameChoice}
                onChange={(value) => setGameChoice(value as GameChoice)}
                options={[
                  { value: "auto", icon: "sparkles", ...create.games.auto },
                  { value: "pick", icon: "puzzle", ...create.games.pick },
                ]}
              />
              {gameChoice === "pick" ? (
                <GamePicker games={games} value={lineup.map(keyOf)} onChange={setGameKeys} />
              ) : null}
              {hasQuiz ? (
                <BankPicker banks={banks} value={bank} onChange={setBank} questions={questions} />
              ) : null}
              <Explainer>{gameDescription}</Explainer>
            </Section>

            {roundsAllowed ? (
              <Section heading={create.rounds.heading}>
                <Segmented
                  stacked
                  label={create.rounds.heading}
                  value={inRounds ? "rounds" : "once"}
                  onChange={(value) => setPlayMode(value as PlayMode)}
                  options={[
                    {
                      value: "once",
                      icon: "trophy",
                      ...create.rounds.once,
                      disabled: lineup.length > 1,
                    },
                    { value: "rounds", icon: "repeat", ...create.rounds.rounds },
                  ]}
                />
                {lineup.length > 1 ? (
                  <p className="caption m-0 text-ink-muted">{create.rounds.needed}</p>
                ) : null}
                {inRounds ? (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      <span className="label">{create.rounds.perRound}</span>
                      <Stepper
                        value={roundWinners}
                        max={winners}
                        onChange={setPerRound}
                        labels={[create.rounds.fewerPerRound, create.rounds.morePerRound]}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="label">{create.rounds.maxWins}</span>
                      <Stepper
                        value={Math.min(maxWins, winners)}
                        max={winners}
                        onChange={setMaxWins}
                        labels={[create.rounds.fewerWins, create.rounds.moreWins]}
                        display={(value) =>
                          value >= winners ? create.rounds.noLimit : String(value)
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="label">{create.rounds.playsFor}</span>
                      <Segmented
                        label={create.rounds.playsFor}
                        value={String(playMinutes)}
                        onChange={(value) => setPlayMinutes(Number(value) as PlayMinutes)}
                        options={PLAY_TIMES.map((minutes) => ({
                          value: String(minutes),
                          label: playTimeLabel(minutes),
                        }))}
                      />
                    </div>
                    {roundsPlanned === 0 ? <ErrorNote>{create.rounds.tooShort}</ErrorNote> : null}
                    <Explainer>
                      {create.rounds.describe({
                        perRound: roundWinners,
                        winners,
                        rounds: roundsPlanned,
                        playTime,
                        games: gameNames,
                        maxWins: winLimit,
                        breakSeconds: Number(breakSeconds) || DEFAULT_ROUND_BREAK_SECONDS,
                      })}
                    </Explainer>
                  </>
                ) : null}
              </Section>
            ) : null}

            <Section heading={create.start.heading}>
              <Segmented
                label={create.start.heading}
                value={when}
                onChange={(value) => setWhen(value as StartChoice)}
                options={[
                  { value: "soon", label: create.start.soon },
                  { value: "later", label: create.start.later },
                  {
                    value: "evening",
                    label: evening.tomorrow ? create.start.tomorrow : create.start.tonight,
                  },
                  { value: "pick", label: create.start.pick },
                ]}
              />
              {when === "pick" ? (
                <Field
                  label={create.startAt}
                  type="datetime-local"
                  value={picked}
                  min={toLocalInput(new Date(now.getTime() + 2 * 60 * 1000))}
                  error={
                    start.getTime() < now.getTime() + 2 * 60 * 1000
                      ? create.start.pastPick
                      : undefined
                  }
                  onChange={(event) => setPicked(event.target.value)}
                />
              ) : null}
              <p className="caption m-0 flex items-center gap-1.5 text-ink-muted">
                <Icon name="clock" size={14} />
                {create.start.at(formatWhen(start.toISOString()))}
                {start > now
                  ? ` · ${create.start.inTime(untilText(start.getTime() - now.getTime()))}`
                  : ""}
              </p>
            </Section>

            <details className="group rounded-lg border border-line bg-surface-raised">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 font-semibold [&::-webkit-details-marker]:hidden">
                {create.advanced.toggle}
                <Icon name="chevron" className="transition-transform group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-5 border-t border-line p-4">
                <p className="caption m-0 text-ink-muted">{create.advanced.lead}</p>
                {inRounds ? (
                  <Field
                    label={create.rounds.breakSeconds}
                    inputMode="numeric"
                    value={breakSeconds}
                    onChange={(event) => setBreakSeconds(event.target.value.replace(/\D/g, ""))}
                  />
                ) : null}
                {hasDice ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={create.advanced.rolls}
                      inputMode="numeric"
                      value={rolls}
                      onChange={(event) => setRolls(event.target.value.replace(/\D/g, ""))}
                    />
                    <Field
                      label={create.advanced.window}
                      inputMode="numeric"
                      value={windowSeconds}
                      onChange={(event) => setWindowSeconds(event.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                ) : null}
                {hasQuiz ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label={create.advanced.questions}
                        inputMode="numeric"
                        value={questions}
                        onChange={(event) => setQuestions(event.target.value.replace(/\D/g, ""))}
                      />
                      <Field
                        label={create.advanced.secondsPerQuestion}
                        inputMode="numeric"
                        value={secondsPerQuestion}
                        onChange={(event) =>
                          setSecondsPerQuestion(event.target.value.replace(/\D/g, ""))
                        }
                      />
                    </div>
                  </>
                ) : null}
                <Field
                  label={create.advanced.minScore}
                  hint={create.advanced.minScoreHint}
                  inputMode="numeric"
                  value={minScore}
                  onChange={(event) => setMinScore(event.target.value.replace(/\D/g, ""))}
                />
              </div>
            </details>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Section heading={create.review.heading} large>
              <p className="body-l m-0 text-ink">
                {create.review.summary({
                  winners,
                  amount: fmt(amount),
                  game: gameNames,
                  when: formatWhen(start.toISOString()),
                  share:
                    reward === "balanced"
                      ? create.review.shareBalanced
                      : reward === "weighted"
                        ? create.review.shareWeighted
                        : create.review.shareRandom,
                })}
              </p>
              <dl className="m-0 flex flex-col rounded-lg border border-line bg-surface-raised px-4">
                <Row label={create.review.rows.prize} value={fmt(amount)} strong />
                <div className="flex items-center justify-between gap-4 border-b border-line py-3">
                  <dt className="text-ink-muted">{create.review.rows.token}</dt>
                  <dd className="m-0 flex min-w-0 items-center justify-end gap-2">
                    <TokenAvatar symbol={token.symbol} chainId={token.chainId} size={24} />
                    <span className="truncate font-semibold">
                      {token.symbol}
                      <span className="font-normal text-ink-muted"> · {token.name}</span>
                    </span>
                  </dd>
                </div>
                <Row label={create.review.rows.network} value={chainName(token.chainId)} />
                {token.native ? null : (
                  <div className="flex items-baseline justify-between gap-4 border-b border-line py-3">
                    <dt className="text-ink-muted">{create.review.rows.contract}</dt>
                    <dd className="m-0 min-w-0 text-right font-mono text-sm [overflow-wrap:anywhere]">
                      {tokenExplorerUrl(token) ? (
                        <a
                          href={tokenExplorerUrl(token)!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-lagoon hover:underline"
                        >
                          {token.address}
                        </a>
                      ) : (
                        token.address
                      )}
                    </dd>
                  </div>
                )}
                <Row label={create.review.rows.winners} value={String(winners)} />
                <Row label={create.review.rows.game} value={gameNames} />
                {inRounds ? (
                  <>
                    <Row
                      label={create.review.rows.rounds}
                      value={create.rounds.summary(playTime, roundsPlanned, roundWinners)}
                    />
                    <Row
                      label={create.review.rows.maxWins}
                      value={winLimit === null ? create.rounds.noLimit : String(winLimit)}
                    />
                  </>
                ) : null}
                <Row label={create.review.rows.starts} value={formatWhen(start.toISOString())} />
                <Row
                  label={create.review.rows.leftovers}
                  value={create.review.rows.leftoversValue}
                />
              </dl>
              {token.trust !== "verified" && token.warning ? (
                <p className="caption m-0 flex gap-2 rounded-md bg-flare-soft p-3 text-flare-strong">
                  <Icon name="alert" size={16} className="mt-0.5" />
                  <span className="[overflow-wrap:anywhere]">{token.warning}</span>
                </p>
              ) : null}
              {reward === "random" ? <PlacesPreview places={places} format={fmt} /> : null}
              <p className="caption m-0 flex gap-2 text-ink-muted">
                <Icon name="shield" size={16} className="mt-0.5" />
                <span>{create.review.trust}</span>
              </p>
            </Section>

            {steps ? (
              <LockProgress steps={steps} token={token} amount={fmt(amount)} />
            ) : (
              <NetworkNotice token={token} walletChain={walletChain} owner={owner} />
            )}

            <Section heading={create.review.payHeading}>
              <Segmented
                stacked
                label={create.review.payHeading}
                value={pay}
                onChange={setPay}
                options={[
                  { value: "wallet", icon: "wallet", ...create.review.wallet },
                  {
                    value: "card",
                    icon: "card",
                    ...create.review.card,
                    disabled: true,
                    badge: copy.comingSoon,
                  },
                  {
                    value: "send",
                    icon: "send",
                    ...create.review.send,
                    disabled: true,
                    badge: copy.comingSoon,
                  },
                ]}
              />
            </Section>
          </>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {step === 1 && prepared instanceof Error ? (
          <ErrorNote>{friendlyError(prepared)}</ErrorNote>
        ) : null}
      </div>

      <TokenPicker
        open={picking}
        onOpenChange={setPicking}
        selected={token}
        owner={owner}
        onConnect={() => void connect()}
        onSelect={(next) => {
          setToken(next);
          setBalance(null);
        }}
      />

      <StickyBar note={step === 2 && busy && steps ? stepNote(steps, token) : undefined}>
        {step === 0 ? (
          <Button size="lg" className="fd-bar-action" iconAfter="arrow" onClick={() => setStep(1)}>
            {create.next.prize}
          </Button>
        ) : null}
        {step === 1 ? (
          <Button
            size="lg"
            className="fd-bar-action"
            iconAfter="arrow"
            disabled={prepared instanceof Error || amount === 0n || overBalance || !acknowledged}
            onClick={() => setStep(2)}
          >
            {create.next.review}
          </Button>
        ) : null}
        {step === 2 ? (
          <Button
            size="lg"
            className="fd-bar-action"
            icon="lock"
            loading={busy}
            onClick={() => void lock()}
          >
            {busy ? create.review.locking : create.review.lock(fmt(amount))}
          </Button>
        ) : null}
      </StickyBar>
    </div>
  );
}

/** Rounds that fit in the play time, or 0 when the settings can't run. */
function plannedRounds(
  settings: {
    games: { id: string; version: string; config: Record<string, unknown> }[];
    winnersPerRound: number;
    playSeconds: number;
    cooldownSeconds: number;
    maxWinsPerPlayer?: number;
  },
  places: number,
  minScore: number,
): number {
  const parsed = rounds.config.safeParse({
    games: settings.games,
    places,
    winnersPerRound: settings.winnersPerRound,
    playSeconds: settings.playSeconds,
    cooldownSeconds: settings.cooldownSeconds,
    maxWinsPerPlayer: settings.maxWinsPerPlayer ?? null,
    minScore,
  });
  return parsed.success ? roundCount(parsed.data, findHostedGame) : 0;
}

/** Validates the giveaway; returns the problem instead of throwing, so the form can show it. */
function buildGiveaway(input: Parameters<typeof prepareGiveaway>[0]) {
  try {
    return prepareGiveaway(input);
  } catch (caught) {
    return caught instanceof Error ? caught : new Error("Check the prize details.");
  }
}

function parseAmount(value: string, decimals: number): bigint {
  try {
    return parseUnits(value || "0", decimals);
  } catch {
    return 0n;
  }
}

function StepHeader({ step, onBack }: { step: number; onBack: () => void }) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={copy.back}
          onClick={onBack}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-sunken text-ink hover:bg-line"
        >
          <Icon name="back" />
        </button>
        <span className="flex-1 font-semibold">{create.title}</span>
        <span className="caption text-ink-muted">{create.step(step + 1, STEPS)}</span>
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: STEPS }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-300",
              index <= step ? "bg-lagoon" : "bg-surface-sunken",
            )}
          />
        ))}
      </div>
    </header>
  );
}

function Section({
  heading,
  lead,
  large = false,
  children,
}: {
  heading: string;
  lead?: string;
  large?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className={cn("m-0 text-balance", large ? "title-l" : "title-m")}>{heading}</h2>
        {lead ? <p className="m-0 text-ink-muted">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Explainer({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-md bg-surface-sunken px-4 py-3 text-[15px] leading-6 text-ink">
      {children}
    </p>
  );
}

function Stepper({
  value,
  onChange,
  max = MAX_WINNERS,
  labels = [create.prize.fewer, create.prize.more],
  display = String,
}: {
  value: number;
  onChange: (next: number) => void;
  max?: number;
  labels?: [string, string];
  display?: (value: number) => string;
}) {
  const key =
    "grid size-11 place-items-center rounded-md bg-surface-raised text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong),var(--edge-neutral)] mb-1 active:translate-y-1 active:shadow-[inset_0_0_0_1.5px_var(--line-strong)] disabled:opacity-40";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className={key}
        aria-label={labels[0]}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Icon name="minus" />
      </button>
      <span
        className="min-w-10 text-center font-display text-3xl font-extrabold tabular-nums"
        aria-live="polite"
      >
        {display(value)}
      </span>
      <button
        type="button"
        className={key}
        aria-label={labels[1]}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

function PlacesPreview({
  places,
  format,
}: {
  places: bigint[];
  format: (value: bigint) => string;
}) {
  if (places.length === 0) return null;
  const top = places.reduce((max, value) => (value > max ? value : max), 0n) || 1n;
  const shown = places.slice(0, 3);
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {shown.map((value, index) => (
        <li key={index} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3">
          <span className="font-mono text-sm font-semibold text-ink-muted">#{index + 1}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-sunken">
            <span
              className="block h-full rounded-full bg-lagoon transition-[width] duration-300"
              style={{ width: `${Number((value * 100n) / top)}%` }}
            />
          </span>
          <span className="font-display text-sm font-extrabold text-lagoon tabular-nums">
            {format(value)}
          </span>
        </li>
      ))}
      {places.length > shown.length ? (
        <li className="caption pl-11 text-ink-muted">
          {create.reward.morePlaces(places.length - shown.length)}
        </li>
      ) : null}
    </ol>
  );
}

/**
 * FairDrops games can be combined: each picked game takes a turn, one round each, in the order
 * picked. A partner game runs on its own, so picking one replaces the others.
 */
function GamePicker({
  games,
  value,
  onChange,
}: {
  games: GameRef[];
  value: string[];
  onChange: (keys: string[]) => void;
}) {
  const builtIn = games.filter((game) => !game.external);
  const external = games.filter((game) => game.external);
  const keyOf = (game: GameRef) => `${game.id}@${game.version}`;
  const toggle = (game: GameRef) => {
    const key = keyOf(game);
    if (game.external) return onChange([key]);
    const current = value.filter((item) => builtIn.some((known) => keyOf(known) === item));
    if (current.includes(key)) {
      if (current.length > 1) onChange(current.filter((item) => item !== key));
    } else {
      onChange([...current, key]);
    }
  };
  const option = (game: GameRef) => {
    const key = keyOf(game);
    const order = value.indexOf(key);
    const on = order >= 0;
    const icon = BUILT_IN.find((item) => item.id === game.id && !game.external)?.icon ?? "puzzle";
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        onClick={() => toggle(game)}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-md border bg-surface-raised p-3 text-left transition-colors",
          on
            ? "border-lagoon bg-lagoon-soft shadow-[inset_0_0_0_1px_var(--lagoon)]"
            : "border-line hover:border-line-strong hover:bg-surface-sunken",
        )}
      >
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md text-on-stage",
            game.external ? "stage-custom" : `stage-${game.id}`,
          )}
        >
          <Icon name={icon} size={18} />
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{game.name}</span>
        {on && value.length > 1 ? (
          <span
            aria-label={create.games.order(order + 1)}
            className="grid size-6 shrink-0 place-items-center rounded-full bg-lagoon text-xs font-bold text-white"
          >
            {order + 1}
          </span>
        ) : null}
      </button>
    );
  };
  const externalPicked = value.some((key) => external.some((game) => keyOf(game) === key));
  return (
    <div role="group" aria-label={create.games.heading} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="overline text-ink-muted">{create.games.builtIn}</span>
        <div className="grid grid-cols-2 gap-2">{builtIn.map(option)}</div>
        <p className="caption m-0 text-ink-muted">{create.games.multiHint}</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="overline text-ink-muted">{create.games.yours}</span>
        {external.length ? (
          <div className="grid grid-cols-2 gap-2">{external.map(option)}</div>
        ) : (
          <p className="caption m-0 text-ink-muted">{create.games.noneYours}</p>
        )}
        {externalPicked ? (
          <p className="caption m-0 text-ink-muted">{create.games.externalAlone}</p>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd
        className={cn(
          "m-0 text-right",
          strong ? "font-display text-lg font-extrabold text-lagoon" : "font-semibold",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** One box: the amount on the left, the token on the right, and the token's context underneath. */
function PrizeInput({
  token,
  value,
  onChange,
  balance,
  over,
  onPick,
}: {
  token: TokenView;
  value: string;
  onChange: (value: string) => void;
  balance: bigint | null;
  over: boolean;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="prize-amount" className="label">
        {create.prize.amount}
      </label>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-surface-raised py-2 pr-2 pl-4",
          over ? "border-danger" : "border-line focus-within:border-focus",
        )}
      >
        <input
          id="prize-amount"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ""))}
          className="min-w-0 flex-1 bg-transparent font-display text-3xl font-extrabold tabular-nums outline-none"
          aria-describedby="prize-token-facts"
        />
        <button
          type="button"
          onClick={onPick}
          className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface py-1.5 pr-3 pl-1.5 font-semibold hover:border-line-strong"
          aria-label={`Prize token: ${token.symbol} on ${chainName(token.chainId)}. Change`}
        >
          <TokenAvatar symbol={token.symbol} chainId={token.chainId} size={28} />
          <span className="max-w-[7rem] truncate">{token.symbol}</span>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      <div id="prize-token-facts" className="flex flex-wrap items-center justify-between gap-2">
        <TokenFacts token={token} />
        {balance !== null ? (
          <span className={cn("caption", over ? "text-danger" : "text-ink-muted")}>
            {over ? "More than you have · " : "Balance "}
            <button
              type="button"
              className="font-semibold text-lagoon hover:underline"
              onClick={() => onChange(trimUnits(balance, token.decimals))}
            >
              {displayUnits(balance, token.decimals)} {token.symbol}
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The exact balance as a decimal string, for "Max". */
function trimUnits(value: bigint, decimals: number): string {
  const text = formatUnits(value, decimals);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** Shown for any token FairDrops hasn't verified; the host must confirm before continuing. */
function UnverifiedNotice({
  token,
  checked,
  onCheck,
}: {
  token: TokenView;
  checked: boolean;
  onCheck: (checked: boolean) => void;
}) {
  const explorer = tokenExplorerUrl(token);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-flare bg-flare-soft p-4 text-flare-strong">
      <p className="m-0 flex gap-2 font-semibold">
        <Icon name="alert" size={18} className="mt-0.5" />
        {token.trust === "listed" ? create.prize.listedTitle : create.prize.unverifiedTitle}
      </p>
      <p className="m-0 [overflow-wrap:anywhere]">{token.warning}</p>
      <p className="m-0 font-mono text-sm [overflow-wrap:anywhere]">
        {token.address}
        {explorer ? (
          <>
            {" "}
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="font-body font-semibold underline"
            >
              {create.prize.viewContract}
            </a>
          </>
        ) : null}
      </p>
      <label className="flex cursor-pointer items-start gap-3 font-semibold">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheck(event.target.checked)}
          className="mt-1 size-4 accent-[var(--flare)]"
        />
        {create.prize.acknowledge(token.symbol)}
      </label>
    </div>
  );
}

type StepStatus = "pending" | "skipped" | "signing" | "confirming" | "done" | "failed";
interface LockSteps {
  network: StepStatus;
  approve: StepStatus;
  lock: StepStatus;
}

/** Before locking: which network the wallet is on and what it will be asked, in order. */
function NetworkNotice({
  token,
  walletChain,
  owner,
}: {
  token: TokenView;
  walletChain: number | null;
  owner: Address | null;
}) {
  const target = chainName(token.chainId);
  const ready = owner !== null && walletChain === token.chainId;
  const asks = [
    owner === null ? create.network.askConnect : null,
    ready ? null : create.network.askSwitch(target),
    token.native ? null : create.network.askAllow(token.symbol),
    create.network.askLock,
  ].filter((ask): ask is string => ask !== null);
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        ready ? "border-lagoon bg-lagoon-soft" : "border-line bg-surface-raised",
      )}
    >
      <p className="m-0 flex items-start gap-2 font-semibold">
        <Icon name={ready ? "check" : "wallet"} size={18} className="mt-0.5" />
        <span>
          {owner === null
            ? create.network.notConnected(target)
            : ready
              ? create.network.ready(target)
              : create.network.willSwitch(walletChain ? chainName(walletChain) : null, target)}
        </span>
      </p>
      <ol className="caption m-0 flex list-decimal flex-col gap-1 pl-9 text-ink-muted">
        {asks.map((ask) => (
          <li key={ask}>{ask}</li>
        ))}
      </ol>
    </section>
  );
}

/** While locking: each wallet request, in order, with where it is. */
function LockProgress({
  steps,
  token,
  amount,
}: {
  steps: LockSteps;
  token: TokenView;
  amount: string;
}) {
  const network = chainName(token.chainId);
  const rows: { key: keyof LockSteps; label: string; skipped: string }[] = [
    {
      key: "network",
      label: create.network.stepSwitch(network),
      skipped: create.network.already(network),
    },
    {
      key: "approve",
      label: create.network.stepAllow(amount),
      skipped: token.native
        ? create.network.notNeeded(token.symbol)
        : create.network.alreadyAllowed,
    },
    { key: "lock", label: create.network.stepLock, skipped: "" },
  ];
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4"
      aria-live="polite"
    >
      <span className="overline text-ink-muted">{create.network.progressTitle}</span>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((row) => {
          const status = steps[row.key];
          return (
            <li key={row.key} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border-2",
                  status === "done" && "border-lagoon bg-lagoon text-on-lagoon",
                  status === "skipped" && "border-line bg-surface-sunken text-ink-muted",
                  (status === "signing" || status === "confirming") && "border-lagoon text-lagoon",
                  status === "failed" && "border-danger bg-danger text-on-danger",
                  status === "pending" && "border-line-strong",
                )}
              >
                {status === "done" || status === "skipped" ? (
                  <Icon name="check" size={14} />
                ) : status === "failed" ? (
                  <Icon name="x" size={14} />
                ) : status === "signing" || status === "confirming" ? (
                  <Icon name="spinner" size={14} spin />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={cn("font-semibold", status === "pending" && "text-ink-muted")}>
                  {row.label}
                </span>
                <span className="caption text-ink-muted">
                  {status === "signing"
                    ? create.network.confirmInWallet
                    : status === "confirming"
                      ? create.network.waitingFor(network)
                      : status === "skipped"
                        ? row.skipped
                        : status === "failed"
                          ? create.network.stopped
                          : status === "done"
                            ? create.network.doneLabel
                            : create.network.next}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The one-line instruction under the button while locking. */
function stepNote(steps: LockSteps, token: TokenView): string {
  const network = chainName(token.chainId);
  if (steps.network === "signing") return create.network.noteSwitch(network);
  const active = (["approve", "lock"] as const).find(
    (step) => steps[step] === "signing" || steps[step] === "confirming",
  );
  if (!active) return create.review.confirm;
  return steps[active] === "signing"
    ? create.network.confirmInWallet
    : create.network.waitingFor(network);
}

/** "15 min", "2 h 5 min", "3 days": how far away the start is. */
function untilText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Where a quiz's questions come from. Each game draws its questions at random from the chosen
 * bank, using the committed seed, so the draw is checkable afterwards. The questions themselves
 * stay private until the game is over.
 */
function BankPicker({
  banks,
  value,
  onChange,
  questions,
}: {
  banks: QuizBankView[];
  value: string;
  onChange: (hash: string) => void;
  questions: string;
}) {
  const list: QuizBankView[] = banks.length
    ? banks
    : [{ hash: DEFAULT_QUIZ_BANK_HASH, name: "FairDrops mix", questions: 100, builtin: true }];
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{create.games.questionsFrom}</span>
      <Segmented
        stacked
        label={create.games.questionsFrom}
        value={value}
        onChange={onChange}
        options={list.map((bank) => ({
          value: bank.hash,
          icon: "quiz" as const,
          label: bank.name,
          hint: create.games.bankHint(bank.questions, Number(questions) || 10, bank.builtin),
        }))}
      />
    </div>
  );
}
