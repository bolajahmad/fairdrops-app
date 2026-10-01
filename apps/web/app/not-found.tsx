import Link from "next/link";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { Shell } from "@/components/shell";

export default function NotFound() {
  return (
    <Shell>
      <EmptyState
        icon="puzzle"
        title="We couldn't find that"
        action={
          <Link href="/">
            <Button>Find a giveaway</Button>
          </Link>
        }
      >
        The link may be mistyped, or the giveaway may have been removed.
      </EmptyState>
    </Shell>
  );
}
