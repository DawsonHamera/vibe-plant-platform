import { Module } from "@nestjs/common";
import { PlantsModule } from "../plants/plants.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [PlantsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
