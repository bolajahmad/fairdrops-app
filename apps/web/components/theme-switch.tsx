"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Segmented } from "./segmented";
import type { ThemeSwitchProps } from "./types";

const emptySubscribe = () => () => {};

export function ThemeSwitch({ value, onChange, compact = false }: ThemeSwitchProps) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const current = value ?? (mounted ? theme : "system") ?? "system";

  return (
    <Segmented
      compact={compact}
      label="Theme"
      value={current === "light" || current === "dark" || current === "system" ? current : "system"}
      onChange={(next) => {
        const choice = next === "light" || next === "dark" ? next : "system";
        setTheme(choice);
        onChange?.(choice);
      }}
      options={[
        { value: "system", label: "Auto", icon: "monitor" },
        { value: "light", label: "Light", icon: "sun" },
        { value: "dark", label: "Dark", icon: "moon" },
      ]}
    />
  );
}
