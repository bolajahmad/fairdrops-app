import type { NestExpressApplication } from "@nestjs/platform-express";
import type { ApiEnv } from "./config/env.js";

/**
 * HTTP settings shared by the server and the tests. Any origin may call the API with a bearer
 * token, which browsers never attach on their own; cookies are only accepted from first-party
 * origins.
 */
export function configureApp(app: NestExpressApplication, env: ApiEnv): void {
  app.set("trust proxy", env.TRUST_PROXY);
  app.enableShutdownHooks();
  app.enableCors((request: { headers: { origin?: string } }, callback) => {
    const origin = request.headers.origin;
    callback(null, {
      origin: true,
      credentials: origin !== undefined && env.APP_ORIGINS.includes(origin),
      allowedHeaders: ["authorization", "content-type", "x-api-key", "x-request-id"],
      exposedHeaders: ["x-request-id", "retry-after"],
      maxAge: 600,
    });
  });
}
