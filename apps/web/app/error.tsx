"use client"; // Error boundaries must be Client Components.

import Link from "next/link";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { Shell } from "@/components/shell";
import { friendlyError } from "@/lib/errors";

/** Any page that throws lands here, inside the normal app frame, instead of a blank screen. */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <Shell>
      <EmptyState
        icon="alert"
        title="This page hit a problem"
        action={
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => retry()}>Try again</Button>
            <Link href="/">
              <Button variant="secondary">Go to Discover</Button>
            </Link>
          </div>
        }
      >
        {friendlyError(error, "Something went wrong while loading it.")}
      </EmptyState>
    </Shell>
  );
}
