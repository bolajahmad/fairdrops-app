import { Module } from "@nestjs/common";
import { ProfilesController, WalletsController } from "./profiles.controller.js";
import { ProfilesService } from "./profiles.service.js";

@Module({
  controllers: [ProfilesController, WalletsController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
