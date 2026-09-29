import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ClaimRelayer } from "./claim-relayer.js";
import { GiveawayUnwinder } from "./giveaway-unwinder.js";
import { SettlementBuilder } from "./settlement-builder.js";
import { SettlementQueues } from "./settlement-queues.js";
import { SettlementReconciler } from "./settlement-reconciler.js";
import { SettlementSubmitter } from "./settlement-submitter.js";
import { SettlementVerifier } from "./settlement-verifier.js";

@Module({
  imports: [SessionsModule],
  providers: [
    SettlementBuilder,
    SettlementVerifier,
    SettlementSubmitter,
    ClaimRelayer,
    GiveawayUnwinder,
    SettlementQueues,
    SettlementReconciler,
  ],
  exports: [
    SettlementBuilder,
    SettlementVerifier,
    SettlementSubmitter,
    ClaimRelayer,
    GiveawayUnwinder,
    SettlementQueues,
    SettlementReconciler,
  ],
})
export class SettlementModule {}
