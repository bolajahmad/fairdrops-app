import { Module } from "@nestjs/common";
import { ProfilesModule } from "../profiles/profiles.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwksController } from "./jwks.controller.js";
import { PRIVY_GATEWAY, PrivyClientGateway } from "./privy.gateway.js";

@Module({
  imports: [ProfilesModule],
  controllers: [AuthController, JwksController],
  providers: [AuthService, { provide: PRIVY_GATEWAY, useClass: PrivyClientGateway }],
})
export class AuthModule {}
