import type { ReactNode } from "react";
import type { IconName } from "./types";
import { Icon } from "./icon";

/** A designed "nothing here" or "can't show this" block: icon, title, one line, one action. */
export function EmptyState({
  icon = "gift",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-line-strong px-6 py-10 md:items-center md:text-center">
      <span className="grid size-12 place-items-center rounded-full bg-surface-sunken text-ink-muted">
        <Icon name={icon} size={22} />
      </span>
      <div className="flex max-w-[44ch] flex-col gap-1.5">
        <h2 className="title-m m-0 text-balance">{title}</h2>
        {children ? (
          <p className="m-0 text-ink-muted [overflow-wrap:anywhere]">{children}</p>
        ) : null}
      </div>
      {action}
    </section>
  );
}
