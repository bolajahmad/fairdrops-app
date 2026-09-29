import { setTimeout as sleep } from "node:timers/promises";

const started = Date.now();

export function log(message: string): void {
  const elapsed = ((Date.now() - started) / 1000).toFixed(1).padStart(6);
  console.log(`[${elapsed}s] ${message}`);
}

export class ScenarioFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioFailure";
  }
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScenarioFailure(message);
}

/**
 * Polls until `probe` returns a value (not undefined), for up to `timeoutMs`. Errors from the
 * probe count as "not yet" (a 404 before the indexer catches up) until the deadline.
 */
export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs = 3_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const reason = lastError instanceof Error ? ` (last error: ${lastError.message})` : "";
      throw new ScenarioFailure(
        `Timed out after ${timeoutMs / 1000}s waiting for ${what}${reason}`,
      );
    }
    await sleep(intervalMs);
  }
}

export function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new ScenarioFailure(`Set ${name}`);
}
