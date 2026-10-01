"use client";

import { TooltipProvider } from "@radix-ui/react-tooltip";
import { ThemeProvider } from "next-themes";
import { useEffect, type ReactNode } from "react";
import { unlockSound } from "@/lib/sound";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
