import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/**
 * Every error the user sees goes through here: tinted box, icon, and text that wraps anywhere
 * (long hashes and URLs included), so a message can never push the page wider than the screen.
 * Pass text through `friendlyError` first.
 */
export function ErrorNote({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex w-full min-w-0 items-start gap-3 rounded-md bg-danger-soft px-4 py-3 text-danger-strong",
        className,
      )}
    >
      <Icon name="alert" size={18} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="m-0 [overflow-wrap:anywhere]">{children}</p>
        {action}
      </div>
    </div>
  );
}
