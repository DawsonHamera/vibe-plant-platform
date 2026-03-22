import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlantsModule } from "../plants/plants.module";
import { TelemetryController } from "./telemetry.controller";
import { TelemetryGateway } from "./telemetry.gateway";
import { TelemetryLegacyGateway } from "./telemetry-legacy.gateway";
import { TelemetryStateService } from "./telemetry-state.service";
import { TelemetryTransportService } from "./telemetry-transport.service";

@Module({
  imports: [AuthModule, PlantsModule],
  controllers: [TelemetryController],
  providers: [
    TelemetryGateway,
    TelemetryLegacyGateway,
    TelemetryTransportService,
    TelemetryStateService,
  ],
  exports: [TelemetryTransportService, TelemetryStateService],
})
export class TelemetryModule {}
