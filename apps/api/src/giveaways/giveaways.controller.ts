import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import {
  addressSchema,
  bytes32Schema,
  chainIdSchema,
  giveawayListQuerySchema,
  paginationQuerySchema,
  uuidSchema,
  type Address,
  type ClaimView,
  type GiveawayEventView,
  type GiveawayListQuery,
  type GiveawayView,
  type Hex,
  type Page,
  type PaginationQuery,
  type PayoutTreeDump,
  type SettlementView,
} from "@fairdrops/shared";
import type { AuthContext } from "../auth/auth.types.js";
import { AuthGuard, CurrentAuth } from "../auth/guards.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { GiveawaysService } from "./giveaways.service.js";

const chainIdPipe = new ZodValidationPipe(chainIdSchema);
const giveawayIdPipe = new ZodValidationPipe(bytes32Schema);

@Controller("giveaways")
export class GiveawaysController {
  constructor(private readonly giveaways: GiveawaysService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(giveawayListQuerySchema)) query: GiveawayListQuery,
  ): Promise<Page<GiveawayView>> {
    return this.giveaways.list(query);
  }

  @Get(":chainId/:giveawayId")
  get(
    @Param("chainId", chainIdPipe) chainId: number,
    @Param("giveawayId", giveawayIdPipe) giveawayId: Hex,
  ): Promise<GiveawayView> {
    return this.giveaways.get(chainId, giveawayId);
  }

  @Get(":chainId/:giveawayId/events")
  events(
    @Param("chainId", chainIdPipe) chainId: number,
    @Param("giveawayId", giveawayIdPipe) giveawayId: Hex,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Page<GiveawayEventView>> {
    return this.giveaways.events(chainId, giveawayId, query);
  }
}

/** A session's result: its payouts, the verifier signatures and the payout tree. */
@Controller("sessions")
export class SettlementsController {
  constructor(private readonly giveaways: GiveawaysService) {}

  @Get(":id/settlement")
  settlement(@Param("id", new ZodValidationPipe(uuidSchema)) id: string): Promise<SettlementView> {
    return this.giveaways.settlement(id);
  }

  @Get(":id/payout-tree")
  payoutTree(@Param("id", new ZodValidationPipe(uuidSchema)) id: string): Promise<PayoutTreeDump> {
    return this.giveaways.payoutTree(id);
  }
}

@Controller()
export class ClaimsController {
  constructor(private readonly giveaways: GiveawaysService) {}

  /** Public: the payout tree is public once a result is proposed. */
  @Get("claims/:chainId/:giveawayId/:account")
  claim(
    @Param("chainId", chainIdPipe) chainId: number,
    @Param("giveawayId", giveawayIdPipe) giveawayId: Hex,
    @Param("account", new ZodValidationPipe(addressSchema)) account: Address,
  ): Promise<ClaimView> {
    return this.giveaways.claim(chainId, giveawayId, account);
  }

  @Get("me/claims")
  @UseGuards(AuthGuard)
  mine(@CurrentAuth() auth: AuthContext): Promise<ClaimView[]> {
    return this.giveaways.claimsOf(auth.userId);
  }
}
