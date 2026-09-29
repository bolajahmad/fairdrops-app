import { Module } from "@nestjs/common";
import { GameResourcesController } from "./game-resources.controller.js";
import { GameResourcesService } from "./game-resources.service.js";
import { SessionGateway } from "./session.gateway.js";
import { SessionsController } from "./sessions.controller.js";
import { SessionsService } from "./sessions.service.js";

@Module({
  controllers: [SessionsController, GameResourcesController],
  providers: [SessionsService, GameResourcesService, SessionGateway],
  exports: [SessionGateway],
})
export class SessionsModule {}
