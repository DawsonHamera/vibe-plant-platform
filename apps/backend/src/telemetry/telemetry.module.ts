import { Module } from "@nestjs/common";
import { PlantsModule } from "../plants/plants.module";
import { TelemetryController } from "./telemetry.controller";
import { TelemetryGateway } from "./telemetry.gateway";
import { TelemetryLegacyGateway } from "./telemetry-legacy.gateway";
import { TelemetryStateService } from "./telemetry-state.service";
import { TelemetryTransportService } from "./telemetry-transport.service";
import { TelemetryService } from "./telemetry.service";

@Module({
  imports: [PlantsModule],
  controllers: [TelemetryController],
  providers: [
    TelemetryGateway,
    TelemetryLegacyGateway,
    TelemetryTransportService,
    TelemetryService,
    TelemetryStateService,
  ],
  exports: [TelemetryTransportService, TelemetryStateService],
})
export class TelemetryModule {}
