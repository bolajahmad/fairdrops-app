import type { Address, Role } from "@fairdrops/shared";

/** Who is calling, as proven by a valid access token. */
export interface AuthContext {
  userId: string;
  wallet: Address;
  sessionId: string;
  roles: Role[];
}
