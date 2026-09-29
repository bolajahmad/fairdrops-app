/** What the SDK keeps between requests once signed in. */
export interface StoredSession {
  accessToken: string;
  accessTokenExpiresAt: string;
  /** Absent with the cookie transport, where the browser holds it. */
  refreshToken?: string;
}

/** Where tokens live. Pick one that fits the app; the default keeps them in memory. */
export interface TokenStore {
  get(): StoredSession | null;
  set(session: StoredSession | null): void;
}

export class MemoryTokenStore implements TokenStore {
  private session: StoredSession | null = null;

  get(): StoredSession | null {
    return this.session;
  }

  set(session: StoredSession | null): void {
    this.session = session;
  }
}

/**
 * Keeps the session in `localStorage`, so it survives reloads. Anything that can run script on
 * the page can read it; prefer the cookie transport on first-party pages.
 */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | undefined {
  return (globalThis as { localStorage?: StorageLike }).localStorage;
}

export class LocalStorageTokenStore implements TokenStore {
  constructor(private readonly key = "fairdrops.session") {}

  get(): StoredSession | null {
    try {
      const raw = storage()?.getItem(this.key);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      return null;
    }
  }

  set(session: StoredSession | null): void {
    try {
      if (session) storage()?.setItem(this.key, JSON.stringify(session));
      else storage()?.removeItem(this.key);
    } catch {
      // Storage can be unavailable (private mode, blocked site data); stay signed in in memory.
    }
  }
}
