import { Module } from "@nestjs/common";
import { WORKER_ENV, type WorkerEnv } from "../config/env.js";
import {
  IndexerService,
  SUBGRAPH_CLIENT_FACTORY,
  createHttpSubgraphClient,
} from "./indexer.service.js";

@Module({
  providers: [
    IndexerService,
    {
      provide: SUBGRAPH_CLIENT_FACTORY,
      inject: [WORKER_ENV],
      useFactory: (env: WorkerEnv) => createHttpSubgraphClient(env),
    },
  ],
  exports: [IndexerService],
})
export class IndexerModule {}
