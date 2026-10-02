import { Module } from "@nestjs/common";
import { BuiltinCatalog } from "./builtin-catalog.js";
import { OnchainSeedCommitter, SEED_COMMITTER } from "./seed-committer.js";
import { SeedVault } from "./seed-vault.js";
import { SessionBus } from "./session-bus.js";
import { SessionLifecycle } from "./session-lifecycle.js";
import { SessionPlanner } from "./session-planner.js";
import { SessionQueues } from "./session-queues.js";
import { SessionSupervisor } from "./session-supervisor.js";

@Module({
  providers: [
    BuiltinCatalog,
    SeedVault,
    SessionBus,
    SessionLifecycle,
    SessionQueues,
    SessionPlanner,
    SessionSupervisor,
    { provide: SEED_COMMITTER, useClass: OnchainSeedCommitter },
  ],
  exports: [
    BuiltinCatalog,
    SessionLifecycle,
    SessionPlanner,
    SessionQueues,
    SessionSupervisor,
    SeedVault,
  ],
})
export class SessionsModule {}
