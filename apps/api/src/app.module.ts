import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApiKeysModule } from "./api-keys/api-keys.module.js";
import { AuthCoreModule } from "./auth/auth-core.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { ErrorFilter } from "./common/error.filter.js";
import { RequestContextMiddleware } from "./common/request-context.middleware.js";
import { ConfigModule } from "./config/config.module.js";
import { ContractsModule } from "./contracts/contracts.module.js";
import { GamesModule } from "./games/games.module.js";
import { HealthModule } from "./health/health.module.js";
import { InfraModule } from "./infra/infra.module.js";
import { ProfilesModule } from "./profiles/profiles.module.js";

@Module({
  imports: [
    ConfigModule,
    InfraModule,
    AuthCoreModule,
    HealthModule,
    ContractsModule,
    AuthModule,
    ProfilesModule,
    GamesModule,
    ApiKeysModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*path");
  }
}
