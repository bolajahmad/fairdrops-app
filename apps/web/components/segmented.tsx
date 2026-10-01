"use client";

import * as RadioGroup from "@radix-ui/react-radio-group";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import type { SegmentedProps } from "./types";

export function Segmented({
  label,
  options,
  value,
  onChange,
  stacked = false,
  compact = false,
}: SegmentedProps) {
  const [internal, setInternal] = useState(options.find((option) => !option.disabled)?.value ?? "");
  const selected = value ?? internal;

  if (stacked) {
    return (
      <RadioGroup.Root
        aria-label={label}
        value={selected}
        onValueChange={(next) => {
          setInternal(next);
          onChange?.(next);
        }}
        className="flex flex-col gap-3"
      >
        {options.map((option) => {
          const on = option.value === selected;
          return (
            <RadioGroup.Item
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={cn(
                "flex w-full items-center gap-4 rounded-lg border bg-surface-raised p-4 text-left transition-[border-color,background-color] duration-150",
                on
                  ? "border-lagoon bg-lagoon-soft shadow-[inset_0_0_0_1px_var(--lagoon)]"
                  : "border-line hover:border-line-strong",
                option.disabled && "cursor-not-allowed opacity-60 hover:border-line",
              )}
            >
              {option.icon ? (
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-md",
                    on ? "bg-lagoon text-on-lagoon" : "bg-surface-sunken text-ink",
                  )}
                >
                  <Icon name={option.icon} />
                </span>
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {option.label}
                  {option.badge ? (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-muted">
                      {option.badge}
                    </span>
                  ) : null}
                </span>
                {option.hint ? <span className="caption text-ink-muted">{option.hint}</span> : null}
              </span>
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border-2",
                  on ? "border-lagoon bg-lagoon text-on-lagoon" : "border-line-strong",
                )}
              >
                {on ? <Icon name="check" size={12} /> : null}
              </span>
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
    );
  }

  return (
    <RadioGroup.Root
      aria-label={label}
      value={selected}
      onValueChange={(next) => {
        setInternal(next);
        onChange?.(next);
      }}
      className="flex gap-1 rounded-lg bg-surface-sunken p-1"
    >
      {options.map((option) => {
        const on = option.value === selected;
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            aria-label={compact ? option.label : undefined}
            title={compact ? option.label : undefined}
            className={cn(
              "inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold whitespace-nowrap transition-[background-color,color] duration-150",
              on
                ? "bg-surface-raised text-ink shadow-[0_2px_0_0_var(--line),inset_0_0_0_1.5px_var(--line-strong)]"
                : "text-ink-muted hover:text-ink",
              option.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {option.icon ? <Icon name={option.icon} size={18} /> : null}
            {compact ? null : <span className="truncate">{option.label}</span>}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
