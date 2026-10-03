"use client";

import {
  apiKeyViewSchema,
  createdApiKeySchema,
  gameDefinitionViewSchema,
  pageSchema,
  type ApiKeyView,
  type CreatedApiKey,
  type GameDefinitionView,
} from "@fairdrops/shared";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { CodeBlock } from "@/components/code-block";
import { ErrorNote } from "@/components/error-note";
import { Field } from "@/components/field";
import { Icon } from "@/components/icon";
import { Shell } from "@/components/shell";
import { SignInPanel } from "@/components/sign-in-panel";
import { StatusChip } from "@/components/status-chip";
import type { PlayerStatus } from "@/components/types";
import { useAccount } from "@/lib/account";
import { AccountChip } from "@/components/account-chip";
import { copy } from "@/lib/copy";
import { friendlyError } from "@/lib/errors";
import { browserFairDrops } from "@/lib/fairdrops";

/** Placeholder until the package is published. */
const NPM_URL = "https://www.npmjs.com/package/@fairdrops/sdk";

const INSTALL = `npm install @fairdrops/sdk viem`;

const REPORT = `import { ScoreReporter } from "@fairdrops/sdk/server";
import { privateKeyToAccount } from "viem/accounts";

// Runs on your game's server, never in the browser.
// Keep both keys secret.
const reporter = new ScoreReporter({
  apiUrl: "https://api.fairdrops.app",
  // Created on this page.
  apiKey: process.env.FAIRDROPS_API_KEY,
  // Signs every report. Its address is the
  // reporterAddress you registered for your game.
  reporter: privateKeyToAccount(process.env.REPORTER_KEY),
});

// When a session ends, report each player's score,
// best first. FairDrops checks the signature, then
// pays the winners. Anyone can verify the result.
await reporter.report(sessionId, [
  { player: "0x9f3c…a21b", score: 2310 },
  { player: "0x51d0…7f13", score: 1990 },
]);`;

export function DevelopersScreen() {
  const account = useAccount();
  const [games, setGames] = useState<GameDefinitionView[]>([]);
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [name, setName] = useState("Score reporter");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const signedIn = account.state.status === "signedIn";

  const load = useCallback(async () => {
    try {
      const { games: mine, keys: list } = await fetchMine();
      setGames(mine);
      setKeys(list);
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't load your games and keys."));
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchMine()
      .then(({ games: mine, keys: list }) => {
        if (!live) return;
        setGames(mine);
        setKeys(list);
      })
      .catch((caught: unknown) => {
        if (live) setError(friendlyError(caught, "Couldn't load your games and keys."));
      });
    return () => {
      live = false;
    };
  }, [signedIn]);

  async function createKey() {
    setCreating(true);
    setError(null);
    try {
      const key = await browserFairDrops().http.post("/api-keys", {
        body: { name: name.trim() || "Score reporter", scopes: ["scores:write", "sessions:read"] },
        schema: createdApiKeySchema,
        auth: "required",
      });
      setCreated(key);
      await load();
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't create a key."));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await browserFairDrops().http.request("DELETE", `/api-keys/${id}`, {
        schema: apiKeyViewSchema,
        auth: "required",
      });
      await load();
    } catch (caught) {
      setError(friendlyError(caught, "Couldn't revoke that key."));
    }
  }

  return (
    <Shell>
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-2">
          <span className="overline text-ink-muted">{copy.developers}</span>
          <h1 className="display-l m-0">Bring your own game</h1>
          <p className="m-0 max-w-[60ch] text-ink-muted">
            Your game keeps its own look and runs on your servers. FairDrops handles the players,
            the prize and the proof that nobody cheated.
          </p>
        </div>
        {account.state.status === "signedIn" ? (
          <AccountChip me={account.state.me} onSignOut={() => void account.signOut()} />
        ) : null}
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          {account.state.status === "signedOut" ? (
            <SignInPanel
              title={copy.signIn.developersTitle}
              reason={copy.signIn.developersReason}
              busy={account.busy}
              error={account.error}
              onWallet={() => void account.signInWithWallet()}
              onSocial={(provider) => void account.signInWithSocial(provider)}
            />
          ) : null}

          {signedIn ? (
            <>
              <section className="flex flex-col gap-4">
                <h2 className="title-m m-0">Your games</h2>
                {games.length ? (
                  <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-lg border border-line bg-surface-raised p-0">
                    {games.map((game) => (
                      <li
                        key={`${game.id}@${game.version}`}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <span className="stage-custom grid size-10 shrink-0 place-items-center rounded-md">
                          <Icon name="puzzle" size={18} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-semibold">{game.name}</span>
                          <span className="mono-s truncate text-ink-muted">
                            {game.id}@{game.version}
                          </span>
                        </span>
                        <StatusChip
                          status={gameStatus(game.status)}
                          label={gameLabel(game.status)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 rounded-lg border border-dashed border-line-strong p-4 text-ink-muted">
                    No games yet. Register one through the API (see the guide), and it shows up here
                    while it&apos;s reviewed.
                  </p>
                )}
              </section>

              <section className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="title-m m-0">API keys</h2>
                  <p className="caption m-0 text-ink-muted">
                    Your game server uses a key to report scores. Keep it secret.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Field
                    className="flex-1"
                    label="Key name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Button loading={creating} onClick={() => void createKey()}>
                    Create key
                  </Button>
                </div>
                {created ? <NewKey secret={created.secret} /> : null}
                {keys.length ? (
                  <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-lg border border-line bg-surface-raised p-0">
                    {keys.map((key) => (
                      <li key={key.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-semibold">{key.name}</span>
                          <span className="mono-s truncate text-ink-muted">
                            {key.prefix}••••••••
                          </span>
                        </span>
                        {key.revokedAt ? (
                          <span className="caption text-ink-muted">Revoked</span>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => void revoke(key.id)}>
                            Revoke
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </>
          ) : null}

          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </div>

        <section className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h2 className="title-m m-0">Report scores from your game</h2>
            <p className="m-0 text-ink-muted">
              Two steps: install the SDK on your game server, then report each player&apos;s score
              when a session ends.
            </p>
          </div>
          <Step n={1} title="Install the SDK">
            <CodeBlock code={INSTALL} lang="bash" file="Terminal" />
            <a
              href={NPM_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-lagoon hover:underline"
            >
              @fairdrops/sdk on npm
              <Icon name="arrow" size={16} />
            </a>
          </Step>
          <Step n={2} title="Report the scores">
            <CodeBlock code={REPORT} file="report-scores.ts" />
          </Step>
        </section>
      </div>
    </Shell>
  );
}

async function fetchMine(): Promise<{ games: GameDefinitionView[]; keys: ApiKeyView[] }> {
  const fd = browserFairDrops();
  const [gamePage, keys] = await Promise.all([
    fd.http.get("/games", {
      query: { owner: "mine" },
      schema: pageSchema(gameDefinitionViewSchema),
      auth: "required",
    }),
    fd.http.get("/api-keys", { schema: apiKeyViewSchema.array(), auth: "required" }),
  ]);
  return { games: gamePage.items, keys };
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-lagoon-soft font-mono text-sm font-bold text-lagoon-strong">
          {n}
        </span>
        <h3 className="m-0 font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function NewKey({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-lagoon bg-lagoon-soft p-4">
      <span className="font-semibold text-lagoon-strong">Your new key</span>
      <div className="flex min-w-0 items-center gap-2 rounded-md bg-surface-raised px-3 py-2">
        <code className="mono-s min-w-0 flex-1 [overflow-wrap:anywhere]">{secret}</code>
        <Button
          size="sm"
          variant="secondary"
          icon={copied ? "check" : undefined}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(secret)
              .then(() => setCopied(true))
              .catch(() => {});
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <span className="caption text-lagoon-strong">
        Copy it now. You won&apos;t be able to see it again.
      </span>
    </div>
  );
}

function gameStatus(status: GameDefinitionView["status"]): PlayerStatus {
  switch (status) {
    case "APPROVED":
      return "live";
    case "PENDING_REVIEW":
      return "upcoming";
    case "DISABLED":
      return "ended";
    case "DRAFT":
      return "upcoming";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function gameLabel(status: GameDefinitionView["status"]): string {
  return { APPROVED: "Live", PENDING_REVIEW: "In review", DISABLED: "Disabled", DRAFT: "Draft" }[
    status
  ];
}
