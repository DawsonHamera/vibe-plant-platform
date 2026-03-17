import { Injectable } from "@nestjs/common";
import type { TelemetryPoint } from "@vibe/shared";
import { TelemetryGateway } from "./telemetry.gateway";
import { TelemetryLegacyGateway } from "./telemetry-legacy.gateway";

@Injectable()
export class TelemetryTransportService {
  constructor(
    private readonly telemetryGateway: TelemetryGateway,
    private readonly telemetryLegacyGateway: TelemetryLegacyGateway,
  ) {}

  publishTelemetry(point: TelemetryPoint): void {
    this.telemetryGateway.publishTelemetry(point);
    this.telemetryLegacyGateway.publishTelemetry(point);
  }
}
