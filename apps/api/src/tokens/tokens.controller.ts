import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import {
  addressSchema,
  chainIdSchema,
  tokenSearchQuerySchema,
  type Address,
  type TokenSearchQuery,
  type TokenView,
} from "@fairdrops/shared";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { TokensService } from "./tokens.service.js";

/** Public: hosts look tokens up before they sign in. Unknown addresses cost an RPC read, hence the limits. */
@Controller("tokens")
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "tokens-search", limit: 60, windowSeconds: 60, by: "ip" })
  search(
    @Query(new ZodValidationPipe(tokenSearchQuerySchema)) query: TokenSearchQuery,
  ): Promise<TokenView[]> {
    return this.tokens.search(query);
  }

  @Get(":chainId/:address")
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "tokens-get", limit: 60, windowSeconds: 60, by: "ip" })
  get(
    @Param("chainId", new ZodValidationPipe(chainIdSchema)) chainId: number,
    @Param("address", new ZodValidationPipe(addressSchema)) address: Address,
  ): Promise<TokenView> {
    return this.tokens.get(chainId, address);
  }
}
