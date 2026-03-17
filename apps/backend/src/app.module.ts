import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AutomationModule } from "./automation/automation.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { DevicesModule } from "./devices/devices.module";
import { DiagramsModule } from "./diagrams/diagrams.module";
import { PlantsModule } from "./plants/plants.module";
import { TelemetryModule } from "./telemetry/telemetry.module";

@Module({
  imports: [
    DatabaseModule,
    PlantsModule,
    TelemetryModule,
    DashboardModule,
    DevicesModule,
    DiagramsModule,
    AutomationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
