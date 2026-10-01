"use client";

import { LiveConnection } from "@fairdrops/sdk/live";
import { useEffect, useState } from "react";
import { browserFairDrops } from "@/lib/fairdrops";

/** Gateway clock. Null until the connection's first tick, so countdowns never fall back to the device clock. */
export function useServerClock(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let connection: LiveConnection | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancel = false;
    void LiveConnection.connect(browserFairDrops(), { spectate: true })
      .then((live) => {
        if (cancel) {
          live.close();
          return;
        }
        connection = live;
        const tick = () => setNow(live.now());
        tick();
        timer = setInterval(tick, 1000);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
      if (timer) clearInterval(timer);
      connection?.close();
    };
  }, []);

  return now;
}
