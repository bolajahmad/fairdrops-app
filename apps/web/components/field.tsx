"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import type { FieldProps } from "./types";

export function Field({ label, hint, error, prefix, suffix, id, className, ...input }: FieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const described = error || hint ? `${fieldId}-desc` : undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={fieldId} className="label">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-12 items-center gap-2 rounded-sm border bg-surface-raised px-3",
          error ? "border-danger" : "border-line focus-within:border-focus",
        )}
      >
        {prefix ? <span className="text-ink-muted">{prefix}</span> : null}
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          className="min-w-0 flex-1 border-0 bg-transparent py-2 text-base text-ink outline-none"
          {...input}
        />
        {suffix ? <span className="font-semibold text-ink-muted">{suffix}</span> : null}
      </div>
      {error || hint ? (
        <p
          id={described}
          className={cn("caption m-0 flex gap-1", error ? "text-danger" : "text-ink-muted")}
        >
          {error ? <Icon name="alert" size={14} /> : null}
          <span className="min-w-0 [overflow-wrap:anywhere]">{error || hint}</span>
        </p>
      ) : null}
    </div>
  );
}
