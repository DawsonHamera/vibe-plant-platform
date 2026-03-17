import { Module } from "@nestjs/common";
import { DiagramsModule } from "../diagrams/diagrams.module";
import { PlantsModule } from "../plants/plants.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { AutomationController } from "./automation.controller";
import { AutomationFlowService } from "./automation-flow.service";
import { AutomationRuntimeService } from "./automation-runtime.service";
import { AutomationService } from "./automation.service";

@Module({
  imports: [PlantsModule, TelemetryModule, DiagramsModule],
  controllers: [AutomationController],
  providers: [AutomationService, AutomationRuntimeService, AutomationFlowService],
})
export class AutomationModule {}
