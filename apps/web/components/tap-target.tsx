"use client";

import { useEffect, useRef, useState } from "react";
import type { TapTargetProps } from "./types";

export function TapTarget({
  count = 0,
  label = "TAP",
  hint,
  disabled = false,
  onTap,
}: TapTargetProps) {
  const countRef = useRef(count);
  const [shown, setShown] = useState(count);
  const [prevCount, setPrevCount] = useState(count);
  const [pop, setPop] = useState(0);
  if (count !== prevCount) {
    setPrevCount(count);
    setShown(count);
  }
  useEffect(() => {
    countRef.current = count;
  }, [count]);

  function tap() {
    if (disabled) return;
    const next = countRef.current + 1;
    countRef.current = next;
    setShown(next);
    setPop((value) => value + 1);
    onTap?.(next);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <span key={pop} className="score-xl motion-pop text-on-stage tabular-nums" aria-live="polite">
        {shown}
      </span>
      <button
        type="button"
        disabled={disabled}
        className="grid size-[168px] touch-manipulation place-items-center rounded-full border-0 bg-flare text-2xl font-extrabold text-on-flare shadow-[0_10px_0_0_var(--flare-press)] select-none active:translate-y-2 active:shadow-none disabled:opacity-45"
        onPointerDown={(event) => {
          event.preventDefault();
          tap();
        }}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            tap();
          }
        }}
      >
        {label}
      </button>
      {hint ? (
        <span className="caption max-w-full text-center break-words text-on-stage/70">{hint}</span>
      ) : null}
    </div>
  );
}
