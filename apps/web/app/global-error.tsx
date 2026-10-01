"use client"; // Error boundaries must be Client Components.

import "./globals.css";

/** Last resort when the root layout itself fails. It must render its own html and body. */
export default function GlobalError({ retry }: { error: Error; retry: () => void }) {
  return (
    <html lang="en">
      <body className="grid min-h-dvh place-items-center p-6">
        <div className="flex max-w-sm flex-col items-start gap-4">
          <h1 className="title-l m-0">FairDrops couldn&apos;t load</h1>
          <p className="m-0 text-ink-muted">
            Something went wrong on our side. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="mb-1 min-h-12 rounded-md bg-lagoon px-5 font-semibold text-on-lagoon shadow-[var(--edge-lagoon)]"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
