import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import type { ButtonProps } from "./types";

const SIZES = {
  sm: "min-h-9 rounded-sm px-3 text-sm",
  md: "min-h-12 rounded-md px-5 text-base",
  lg: "min-h-14 rounded-md px-6 text-lg",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconAfter,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const busy = loading || disabled;
  return (
    <button
      type={type}
      disabled={busy}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex max-w-full shrink-0 touch-manipulation items-center justify-center gap-2 border-0 text-center font-body font-semibold whitespace-nowrap",
        "transition-[transform,box-shadow,filter] duration-75 ease-out",
        SIZES[size],
        block && "flex w-full",
        variant === "primary" &&
          "mb-1 bg-lagoon text-on-lagoon shadow-[var(--edge-lagoon)] hover:brightness-105 active:translate-y-1 active:shadow-none",
        variant === "secondary" &&
          "mb-1 bg-surface-raised text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong),var(--edge-neutral)] hover:brightness-105 active:translate-y-1 active:shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
        variant === "ghost" &&
          "bg-transparent text-lagoon shadow-none hover:bg-lagoon-soft hover:text-lagoon-strong active:translate-y-px",
        variant === "danger" &&
          "mb-1 bg-danger text-on-danger shadow-[var(--edge-danger)] hover:brightness-105 active:translate-y-1 active:shadow-none",
        variant === "flare" &&
          "mb-1 bg-flare text-on-flare shadow-[var(--edge-flare)] hover:brightness-105 active:translate-y-1 active:shadow-none",
        disabled && !loading && "cursor-not-allowed opacity-45",
        loading && "cursor-progress",
        className,
      )}
      {...rest}
    >
      {loading ? <Icon name="spinner" spin /> : icon ? <Icon name={icon} /> : null}
      <span className="min-w-0 truncate">{children}</span>
      {iconAfter && !loading ? <Icon name={iconAfter} /> : null}
    </button>
  );
}
