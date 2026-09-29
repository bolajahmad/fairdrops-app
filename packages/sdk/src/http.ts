import { sessionResponseSchema, type SessionResponse } from "@fairdrops/shared";
import type { z } from "zod";
import { FairDropsError } from "./errors.js";
import { MemoryTokenStore, type StoredSession, type TokenStore } from "./tokens.js";

/** Refresh this long before the access token expires, so requests never race its expiry. */
const REFRESH_MARGIN_MS = 30_000;

export type Transport = "cookie" | "body";

export interface HttpOptions {
  apiUrl: string;
  fetch?: typeof fetch;
  tokenStore?: TokenStore;
  /**
   * How the refresh token travels. `body` (the default) keeps it in the token store and works
   * from any origin. `cookie` keeps it in an HttpOnly cookie, only for FairDrops' own web app.
   */
  transport?: Transport;
  /** Sent as X-API-Key on routes that take one (game servers). */
  apiKey?: string;
}

export type Auth = "none" | "optional" | "required";

export interface RequestOptions<T> {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  schema: z.ZodType<T>;
  auth?: Auth;
  apiKey?: boolean;
}

/**
 * JSON over fetch, with the access token attached and refreshed as needed, and every response
 * checked against its shared schema: if the API and the SDK ever disagree, calls fail loudly
 * instead of returning data of the wrong shape.
 */
export class HttpClient {
  readonly apiUrl: string;
  readonly transport: Transport;
  readonly tokens: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey: string | undefined;
  private refreshing: Promise<StoredSession | null> | null = null;

  constructor(options: HttpOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.transport = options.transport ?? "body";
    this.tokens = options.tokenStore ?? new MemoryTokenStore();
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.apiKey = options.apiKey;
  }

  get<T>(path: string, options: RequestOptions<T>): Promise<T> {
    return this.request("GET", path, options);
  }

  post<T>(path: string, options: RequestOptions<T>): Promise<T> {
    return this.request("POST", path, options);
  }

  async request<T>(method: string, path: string, options: RequestOptions<T>): Promise<T> {
    const auth = options.auth ?? "none";
    let token = auth === "none" ? null : await this.accessToken();
    if (auth === "required" && !token) {
      throw new FairDropsError("UNAUTHENTICATED", "Sign in first", 401);
    }

    let response = await this.send(method, path, options, token);
    if (response.status === 401 && token) {
      // The token may have been revoked or expired early; refresh once and retry.
      token = (await this.refresh(true))?.accessToken ?? null;
      if (token) response = await this.send(method, path, options, token);
    }
    if (!response.ok) throw await FairDropsError.fromResponse(response);
    if (response.status === 204) return options.schema.parse(undefined);

    const body: unknown = await response.json().catch(() => {
      throw new FairDropsError("BAD_RESPONSE", `${method} ${path} did not return JSON`);
    });
    const parsed = options.schema.safeParse(body);
    if (!parsed.success) {
      throw new FairDropsError(
        "BAD_RESPONSE",
        `${method} ${path} returned an unexpected shape`,
        response.status,
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  /** Stores a new sign-in. */
  accept(session: SessionResponse): void {
    this.tokens.set({
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshToken: session.refreshToken,
    });
  }

  /** A valid access token, refreshing it first if it is about to expire. */
  async accessToken(): Promise<string | null> {
    const session = this.tokens.get();
    if (!session)
      return this.transport === "cookie" ? ((await this.refresh())?.accessToken ?? null) : null;
    if (Date.parse(session.accessTokenExpiresAt) - Date.now() > REFRESH_MARGIN_MS) {
      return session.accessToken;
    }
    return (await this.refresh())?.accessToken ?? null;
  }

  /** Rotates the refresh token. Concurrent callers share one request. */
  refresh(force = false): Promise<StoredSession | null> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh(force).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(force: boolean): Promise<StoredSession | null> {
    const current = this.tokens.get();
    if (
      !force &&
      current &&
      Date.parse(current.accessTokenExpiresAt) - Date.now() > REFRESH_MARGIN_MS
    ) {
      return current;
    }
    if (this.transport === "body" && !current?.refreshToken) return null;

    const response = await this.send(
      "POST",
      "/auth/refresh",
      { body: { refreshToken: current?.refreshToken, transport: this.transport } },
      null,
    );
    if (!response.ok) {
      // A refresh token is single-use; a rejected one is gone, so this client is signed out.
      if (response.status === 401 || response.status === 403) {
        this.tokens.set(null);
        return null;
      }
      throw await FairDropsError.fromResponse(response);
    }
    const session = sessionResponseSchema.parse(await response.json());
    this.accept(session);
    return this.tokens.get();
  }

  private async send(
    method: string,
    path: string,
    options: Pick<RequestOptions<unknown>, "body" | "query" | "apiKey">,
    token: string | null,
  ): Promise<Response> {
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.apiKey) {
      if (!this.apiKey) throw new FairDropsError("UNAUTHENTICATED", "This call needs an API key");
      headers["x-api-key"] = this.apiKey;
    }
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: this.transport === "cookie" ? "include" : "omit",
      });
    } catch (error) {
      throw new FairDropsError("NETWORK", `${method} ${path}: ${(error as Error).message}`);
    }
  }
}
