"use client";

import * as RadioGroup from "@radix-ui/react-radio-group";
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
  DEFAULT_TOKEN_KEY,
  findPrizeToken,
  prizeTokens,
  randomBps,
  rewardPolicy,
  startFromChoice,
  type AudienceId,
  type GameChoice,
  type RewardMode,
  type StartChoice,
} from "@/lib/presets";
import { connectInjectedWallet } from "@/lib/wallet";

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
  const [tokenKey, setTokenKey] = useState(DEFAULT_TOKEN_KEY);
  const [winners, setWinners] = useState(preset.winners);
  const [reward, setReward] = useState<RewardMode>(preset.reward);
  const [drawn, setDrawn] = useState<number[]>(() => randomBps(preset.winners));
  const [gameChoice, setGameChoice] = useState<GameChoice>("auto");
  const [gameKey, setGameKey] = useState("dice@1.0.0");
  const [when, setWhen] = useState<StartChoice>(preset.when);
  const [picked, setPicked] = useState("");

  const [rolls, setRolls] = useState("3");
  const [windowSeconds, setWindowSeconds] = useState("120");
  const [bank, setBank] = useState("");
  const [questions, setQuestions] = useState("10");
  const [secondsPerQuestion, setSecondsPerQuestion] = useState("15");
  const [minScore, setMinScore] = useState("1");

  const [pay, setPay] = useState("wallet");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [externalGames, setExternalGames] = useState<GameDefinitionView[]>([]);

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

  const token = findPrizeToken(tokenKey);
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
  const game =
    gameChoice === "auto"
      ? games[0]!
      : (games.find((item) => `${item.id}@${item.version}` === gameKey) ?? games[0]!);

  const amount = parseAmount(pool, token.decimals);
  const policy = { ...rewardPolicy(reward, winners, drawn), minScore: Number(minScore) || 1 };
  const places = amount > 0n ? placeAmounts(amount, policy) : [];
  const fmt = (value: bigint) => `${displayAmount(value, token.decimals)} ${token.symbol}`;
  const start = startFromChoice(when, picked);
  const config: Record<string, unknown> =
    game.id === "quiz" && !game.external
      ? {
          bank,
          questions: Number(questions),
          secondsPerQuestion: Number(secondsPerQuestion),
          revealSeconds: 3,
        }
      : game.id === "dice" && !game.external
        ? { rolls: Number(rolls), dice: 2, sides: 6, windowSeconds: Number(windowSeconds) }
        : {};
  const prepared = buildGiveaway({
    chainId: token.chainId,
    token: token.address,
    amount,
    startTime: start,
    finalizeDeadline: new Date(start.getTime() + 24 * 60 * 60 * 1000),
    maxWinners: winners,
    metadata: {
      v: 2,
      title: title.trim() || "Giveaway",
      description: "",
      game: { id: game.id, version: game.version, config },
      rewards: policy,
    },
  });

  async function lock() {
    if (game.id === "quiz" && !game.external && !/^0x[0-9a-fA-F]{64}$/.test(bank)) {
      setError(create.review.needBank);
      return;
    }
    if (prepared instanceof Error) {
      setError(prepared.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const wallet = await connectInjectedWallet(token.chainId);
      const { giveawayId } = await createGiveaway(wallet, prepared);
      router.push(`/host/${token.chainId}/${giveawayId}/share?title=${encodeURIComponent(title)}`);
    } catch (caught) {
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
        : (create.games.describe[game.id] ?? "");
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
              <Field
                label={create.prize.amount}
                inputMode="decimal"
                value={pool}
                suffix={token.symbol}
                onChange={(event) => setPool(event.target.value.replace(/[^0-9.]/g, ""))}
              />
              <TokenPicker value={tokenKey} onChange={setTokenKey} />
              <p className="caption m-0 text-ink-muted">{create.prize.runsOn(token.chainName)}</p>
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
                <GamePicker
                  games={games}
                  value={`${game.id}@${game.version}`}
                  onChange={setGameKey}
                />
              ) : null}
              <Explainer>{gameDescription}</Explainer>
            </Section>

            <Section heading={create.start.heading}>
              <Segmented
                label={create.start.heading}
                value={when}
                onChange={(value) => setWhen(value as StartChoice)}
                options={[
                  { value: "soon", label: create.start.soon },
                  { value: "tonight", label: create.start.tonight },
                  { value: "pick", label: create.start.pick },
                ]}
              />
              {when === "pick" ? (
                <Field
                  label={create.startAt}
                  type="datetime-local"
                  value={picked}
                  onChange={(event) => setPicked(event.target.value)}
                />
              ) : null}
            </Section>

            <details className="group rounded-lg border border-line bg-surface-raised">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 font-semibold [&::-webkit-details-marker]:hidden">
                {create.advanced.toggle}
                <Icon name="chevron" className="transition-transform group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-5 border-t border-line p-4">
                <p className="caption m-0 text-ink-muted">{create.advanced.lead}</p>
                {game.id === "dice" && !game.external ? (
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
                {game.id === "quiz" && !game.external ? (
                  <>
                    <Field
                      label={create.advanced.bank}
                      hint={create.advanced.bankHint}
                      value={bank}
                      onChange={(event) => setBank(event.target.value.trim())}
                    />
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
                  game: gameChoice === "auto" ? "Dice" : game.name,
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
                <Row label={create.review.rows.network} value={token.chainName} />
                <Row label={create.review.rows.winners} value={String(winners)} />
                <Row
                  label={create.review.rows.game}
                  value={gameChoice === "auto" ? "Dice" : game.name}
                />
                <Row label={create.review.rows.starts} value={formatWhen(start.toISOString())} />
                <Row
                  label={create.review.rows.leftovers}
                  value={create.review.rows.leftoversValue}
                />
              </dl>
              {reward === "random" ? <PlacesPreview places={places} format={fmt} /> : null}
              <p className="caption m-0 flex gap-2 text-ink-muted">
                <Icon name="shield" size={16} className="mt-0.5" />
                <span>{create.review.trust}</span>
              </p>
            </Section>

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

      <StickyBar note={step === 2 && busy ? create.review.confirm : undefined}>
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
            disabled={prepared instanceof Error || amount === 0n}
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

/** Validates the giveaway; returns the problem instead of throwing, so the form can show it. */
function buildGiveaway(input: Parameters<typeof prepareGiveaway>[0]) {
  try {
    return prepareGiveaway(input);
  } catch (caught) {
    return caught instanceof Error ? caught : new Error("Check the prize details.");
  }
}

/** For reading, not for the chain: at most two decimals, grouped for the viewer's locale. */
function displayAmount(value: bigint, decimals: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    Number(formatUnits(value, decimals)),
  );
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

function Stepper({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const key =
    "grid size-11 place-items-center rounded-md bg-surface-raised text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong),var(--edge-neutral)] mb-1 active:translate-y-1 active:shadow-[inset_0_0_0_1.5px_var(--line-strong)] disabled:opacity-40";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className={key}
        aria-label={create.prize.fewer}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Icon name="minus" />
      </button>
      <span
        className="min-w-10 text-center font-display text-3xl font-extrabold tabular-nums"
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        className={key}
        aria-label={create.prize.more}
        disabled={value >= MAX_WINNERS}
        onClick={() => onChange(value + 1)}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

function TokenPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">{create.prize.token}</span>
      <RadioGroup.Root
        aria-label={create.prize.token}
        value={value}
        onValueChange={onChange}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      >
        {prizeTokens.map((token) => {
          const on = token.key === value;
          return (
            <RadioGroup.Item
              key={token.key}
              value={token.key}
              className={cn(
                "flex min-w-0 flex-col items-start rounded-md border bg-surface-raised px-3 py-2 text-left transition-colors",
                on
                  ? "border-lagoon bg-lagoon-soft shadow-[inset_0_0_0_1px_var(--lagoon)]"
                  : "border-line hover:border-line-strong",
              )}
            >
              <span className="font-semibold">{token.symbol}</span>
              <span className="caption w-full truncate text-ink-muted">{token.chainName}</span>
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
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

function GamePicker({
  games,
  value,
  onChange,
}: {
  games: GameRef[];
  value: string;
  onChange: (key: string) => void;
}) {
  const builtIn = games.filter((game) => !game.external);
  const external = games.filter((game) => game.external);
  const option = (game: GameRef) => {
    const key = `${game.id}@${game.version}`;
    const on = key === value;
    const icon = BUILT_IN.find((item) => item.id === game.id && !game.external)?.icon ?? "puzzle";
    return (
      <RadioGroup.Item
        key={key}
        value={key}
        className={cn(
          "flex items-center gap-3 rounded-md border bg-surface-raised p-3 text-left transition-colors",
          on
            ? "border-lagoon bg-lagoon-soft shadow-[inset_0_0_0_1px_var(--lagoon)]"
            : "border-line hover:border-line-strong",
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
        <span className="min-w-0 truncate font-semibold">{game.name}</span>
      </RadioGroup.Item>
    );
  };
  return (
    <RadioGroup.Root
      aria-label={create.games.heading}
      value={value}
      onValueChange={onChange}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <span className="overline text-ink-muted">{create.games.builtIn}</span>
        <div className="grid grid-cols-2 gap-2">{builtIn.map(option)}</div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="overline text-ink-muted">{create.games.yours}</span>
        {external.length ? (
          <div className="grid grid-cols-2 gap-2">{external.map(option)}</div>
        ) : (
          <p className="caption m-0 text-ink-muted">{create.games.noneYours}</p>
        )}
      </div>
      <label className="flex cursor-not-allowed items-start gap-3 rounded-md border border-dashed border-line p-3 opacity-70">
        <input type="checkbox" disabled className="mt-1 size-4" />
        <span className="flex flex-col">
          <span className="font-semibold">{create.games.mix}</span>
          <span className="caption text-ink-muted">{create.games.mixLater}</span>
        </span>
      </label>
    </RadioGroup.Root>
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
