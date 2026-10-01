"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import type { IconButtonProps } from "./types";

export function IconButton({
  icon,
  label,
  tone = "default",
  pressed = false,
  onClick,
  className,
}: IconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          title={label}
          onClick={onClick}
          className={cn(
            "inline-grid size-11 shrink-0 touch-manipulation place-items-center rounded-full",
            tone === "stage"
              ? "bg-white/10 text-on-stage"
              : "bg-surface-raised text-ink shadow-[inset_0_0_0_1.5px_var(--line)]",
            pressed && "bg-lagoon-soft text-lagoon-strong",
            className,
          )}
        >
          <Icon name={icon} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="caption rounded-sm bg-ink px-2 py-1 text-surface"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
