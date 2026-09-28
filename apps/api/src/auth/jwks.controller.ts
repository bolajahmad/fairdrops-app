import { Controller, Get, Header } from "@nestjs/common";
import type { JWK } from "jose";
import { TokenService } from "./token.service.js";

/** Public keys for verifying FairDrops access tokens, e.g. by external game servers. */
@Controller(".well-known")
export class JwksController {
  constructor(private readonly tokens: TokenService) {}

  @Get("jwks.json")
  @Header("Cache-Control", "public, max-age=300")
  jwks(): { keys: JWK[] } {
    return this.tokens.jwks();
  }
}
