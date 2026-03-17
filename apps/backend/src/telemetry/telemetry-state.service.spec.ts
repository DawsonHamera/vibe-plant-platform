import { describe, expect, it } from "vitest";
import { TelemetryStateService } from "./telemetry-state.service";

describe("TelemetryStateService", () => {
  it("tracks ingest volume, cache size, and lookup hit rate", () => {
    const service = new TelemetryStateService();

    service.record({
      plantId: "plant-1",
      moisture: 40,
      light: 250,
      temperature: 21,
      capturedAt: "2026-03-16T12:00:00.000Z",
    });

    service.record({
      plantId: "plant-2",
      moisture: 42,
      light: 260,
      temperature: 22,
      capturedAt: "2026-03-16T12:00:01.000Z",
    });

    service.trackLatestLookup(true);
    service.trackLatestLookup(true);
    service.trackLatestLookup(false);

    expect(service.getStats()).toEqual({
      ingestCount: 2,
      cachedPlantCount: 2,
      latestLookup: {
        hits: 2,
        misses: 1,
        hitRate: 2 / 3,
      },
    });
  });

  it("returns null hit rate when there have been no latest lookups", () => {
    const service = new TelemetryStateService();

    expect(service.getStats().latestLookup.hitRate).toBeNull();
  });
});
