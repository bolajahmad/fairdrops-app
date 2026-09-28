import type { ApiKeyIdentity } from "@fairdrops/shared";
import type { AuthContext } from "../auth/auth.types.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by RequestContextMiddleware for every request. */
      requestId?: string;
      /** Set by AuthGuard (required) or OptionalAuthGuard. */
      auth?: AuthContext;
      /** Set by ApiKeyGuard. */
      apiKey?: ApiKeyIdentity;
    }
  }
}
