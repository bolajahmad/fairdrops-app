import { Global, Module } from "@nestjs/common";
import { PriceFeed } from "./price-feed.js";
import { Keyring } from "./keyring.js";
import { FAIRDROPS_READER, OnchainFairDropsReader } from "./reader.js";
import { CHAIN_RPC, ChainRpcs } from "./rpc.js";
import { TxEngine } from "./tx-engine.js";

/** Chain access for the whole worker: RPC clients, contract reads, keys and the tx engine. */
@Global()
@Module({
  providers: [
    ChainRpcs,
    {
      provide: CHAIN_RPC,
      inject: [ChainRpcs],
      useFactory: (rpcs: ChainRpcs) => rpcs.get.bind(rpcs),
    },
    { provide: FAIRDROPS_READER, useClass: OnchainFairDropsReader },
    Keyring,
    TxEngine,
    PriceFeed,
  ],
  exports: [CHAIN_RPC, FAIRDROPS_READER, Keyring, TxEngine, PriceFeed],
})
export class ChainModule {}
