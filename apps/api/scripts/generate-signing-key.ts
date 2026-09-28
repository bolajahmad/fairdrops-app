/**
 * Prints a new ES256 private key as a JWK, for AUTH_JWT_PRIVATE_JWK.
 *
 *   pnpm --filter @fairdrops/api auth:generate-key
 *
 * Changing the key invalidates outstanding access tokens. Clients recover on their own by
 * refreshing, because refresh tokens are stored server-side and do not depend on this key.
 */
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), kid: randomUUID(), alg: "ES256" };
process.stdout.write(`${JSON.stringify(jwk)}\n`);
