"use client";

import { TooltipProvider } from "@radix-ui/react-tooltip";
import { ThemeProvider } from "next-themes";
import { useEffect, type ReactNode } from "react";
import { SocialSignIn } from "@/components/privy-bridge";
import { useTrackNavigation } from "@/lib/back";
import { unlockSound } from "@/lib/sound";

export function Providers({ children }: { children: ReactNode }) {
  useTrackNavigation();
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
      <TooltipProvider delayDuration={300}>
        <SocialSignIn>{children}</SocialSignIn>
      </TooltipProvider>
    </ThemeProvider>
  );
}
