"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "./icon";

type Lang = "ts" | "bash";

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "const",
  "let",
  "await",
  "async",
  "new",
  "return",
  "function",
  "if",
  "else",
  "for",
  "of",
  "type",
  "interface",
]);
const LITERALS = new Set(["true", "false", "null", "undefined"]);

/** Comments, strings, numbers, words, everything else, in that order of precedence. */
const TOKEN =
  /(\/\/[^\n]*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\d_.]*\b|[A-Za-z_$][\w$]*)/g;

function highlight(code: string, lang: Lang): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    const [text] = match;
    const start = match.index;
    if (start > last) out.push(code.slice(last, start));
    const next = code.slice(start + text.length).trimStart();
    let className: string | null = null;
    if (text.startsWith("//") || (lang === "bash" && text.startsWith("#")))
      className = "tok-comment";
    else if (text.startsWith("#")) className = null;
    else if (/^["'`]/.test(text)) className = "tok-string";
    else if (/^\d/.test(text)) className = "tok-number";
    else if (lang === "bash" && start === code.lastIndexOf("\n", start) + 1) className = "tok-fn";
    else if (KEYWORDS.has(text)) className = "tok-keyword";
    else if (LITERALS.has(text)) className = "tok-number";
    else if (next.startsWith("(")) className = "tok-fn";
    else if (/^[A-Z]/.test(text)) className = "tok-type";
    out.push(
      className ? (
        <span key={start} className={className}>
          {text}
        </span>
      ) : (
        text
      ),
    );
    last = start + text.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

/**
 * Code in the "FairDrops Night" theme: dark in both app themes (like a game stage), lagoon
 * keywords, flare strings, sky functions, muted comments. Scrolls sideways inside itself,
 * never widening the page.
 */
export function CodeBlock({
  code,
  lang = "ts",
  file,
}: {
  code: string;
  lang?: Lang;
  file?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="code-theme m-0 flex min-w-0 flex-col overflow-hidden rounded-lg">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[var(--code-line)] px-4 py-2">
        <span className="font-mono text-xs text-[var(--code-muted)]">{file ?? lang}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(code)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              })
              .catch(() => {});
          }}
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-semibold text-[var(--code-muted)] hover:bg-[var(--code-line)] hover:text-[var(--code-fg)]"
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre className="m-0 overflow-x-auto p-4 font-mono text-[13px] leading-6">
        <code>{highlight(code, lang)}</code>
      </pre>
    </figure>
  );
}
