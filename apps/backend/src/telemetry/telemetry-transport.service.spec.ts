import { describe, expect, it, vi } from "vitest";
import { TelemetryTransportService } from "./telemetry-transport.service";

describe("TelemetryTransportService", () => {
  it("publishes telemetry to current and legacy websocket gateways", () => {
    const telemetryGateway = {
      publishTelemetry: vi.fn(),
    };

    const telemetryLegacyGateway = {
      publishTelemetry: vi.fn(),
    };

    const service = new TelemetryTransportService(
      telemetryGateway as never,
      telemetryLegacyGateway as never,
    );

    const point = {
      plantId: "11111111-1111-1111-1111-111111111111",
      moisture: 42,
      light: 280,
      temperature: 21,
      capturedAt: "2026-03-16T12:00:00.000Z",
    };

    service.publishTelemetry(point);

    expect(telemetryGateway.publishTelemetry).toHaveBeenCalledWith(point);
    expect(telemetryLegacyGateway.publishTelemetry).toHaveBeenCalledWith(point);
  });
});
