import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { TelemetryController } from "./telemetry.controller";

describe("TelemetryController", () => {
  it("returns all telemetry sorted by capturedAt descending when no plantId is provided", () => {
    const points = [
      {
        plantId: "22222222-2222-2222-2222-222222222222",
        moisture: 52,
        light: 320,
        temperature: 23,
        capturedAt: "2026-03-16T12:00:02.000Z",
      },
      {
        plantId: "11111111-1111-1111-1111-111111111111",
        moisture: 41,
        light: 260,
        temperature: 21,
        capturedAt: "2026-03-16T12:00:00.000Z",
      },
    ];

    const plantsService = {
      getById: vi.fn(),
    };

    const telemetryState = {
      getAll: vi.fn(() => [points[1], points[0]]),
      getLatest: vi.fn(),
      record: vi.fn(),
      trackLatestLookup: vi.fn(),
      getStats: vi.fn(() => ({
        ingestCount: 1,
        cachedPlantCount: 2,
        latestLookup: { hits: 0, misses: 0, hitRate: null },
      })),
    };

    const telemetryTransport = {
      publishTelemetry: vi.fn(),
    };

    const controller = new TelemetryController(
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    expect(controller.latest()).toEqual(points);
    expect(telemetryState.getAll).toHaveBeenCalledTimes(1);
    expect(telemetryState.getLatest).not.toHaveBeenCalled();
  });

  it("applies limit for all plants and caps it at 200", () => {
    const points = Array.from({ length: 205 }, (_, index) => ({
      plantId: `${String(index + 1).padStart(12, "0")}-1111-1111-1111-111111111111`,
      moisture: 40,
      light: 250,
      temperature: 22,
      capturedAt: new Date(Date.UTC(2026, 2, 16, 12, 0, index)).toISOString(),
    }));

    const plantsService = {
      getById: vi.fn(),
    };

    const telemetryState = {
      getAll: vi.fn(() => points),
      getLatest: vi.fn(),
      record: vi.fn(),
      trackLatestLookup: vi.fn(),
      getStats: vi.fn(() => ({
        ingestCount: 1,
        cachedPlantCount: 2,
        latestLookup: { hits: 0, misses: 0, hitRate: null },
      })),
    };

    const telemetryTransport = {
      publishTelemetry: vi.fn(),
    };

    const controller = new TelemetryController(
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    const limited = controller.latest(undefined, "3") as Array<(typeof points)[number]>;
    expect(limited).toHaveLength(3);
    expect(limited[0]!.capturedAt >= limited[1]!.capturedAt).toBe(true);
    expect(limited[1]!.capturedAt >= limited[2]!.capturedAt).toBe(true);

    const capped = controller.latest(undefined, "500") as Array<(typeof points)[number]>;
    expect(capped).toHaveLength(200);
    expect(capped[0]!.capturedAt >= capped[199]!.capturedAt).toBe(true);
    expect(telemetryState.getLatest).not.toHaveBeenCalled();
  });

  it("returns all points when limit is non-numeric", () => {
    const points = [
      {
        plantId: "22222222-2222-2222-2222-222222222222",
        moisture: 52,
        light: 320,
        temperature: 23,
        capturedAt: "2026-03-16T12:00:02.000Z",
      },
      {
        plantId: "11111111-1111-1111-1111-111111111111",
        moisture: 41,
        light: 260,
        temperature: 21,
        capturedAt: "2026-03-16T12:00:00.000Z",
      },
    ];

    const plantsService = {
      getById: vi.fn(),
    };

    const telemetryState = {
      getAll: vi.fn(() => [points[1], points[0]]),
      getLatest: vi.fn(),
      record: vi.fn(),
      trackLatestLookup: vi.fn(),
      getStats: vi.fn(() => ({
        ingestCount: 1,
        cachedPlantCount: 2,
        latestLookup: { hits: 0, misses: 0, hitRate: null },
      })),
    };

    const telemetryTransport = {
      publishTelemetry: vi.fn(),
    };

    const controller = new TelemetryController(
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    expect(() => controller.latest(undefined, "not-a-number")).not.toThrow();
    expect(controller.latest(undefined, "not-a-number")).toEqual(points);
    expect(telemetryState.getAll).toHaveBeenCalledTimes(2);
    expect(telemetryState.getLatest).not.toHaveBeenCalled();
  });

  it("returns latest telemetry for a specific plant or null", () => {
    const point = {
      plantId: "11111111-1111-1111-1111-111111111111",
      moisture: 41,
      light: 260,
      temperature: 21,
      capturedAt: "2026-03-16T12:00:00.000Z",
    };

    const plantsService = {
      getById: vi.fn(),
    };

    const telemetryState = {
      getAll: vi.fn(),
      getLatest: vi
        .fn()
        .mockReturnValueOnce(point)
        .mockReturnValueOnce(undefined),
      record: vi.fn(),
      trackLatestLookup: vi.fn(),
      getStats: vi.fn(() => ({
        ingestCount: 1,
        cachedPlantCount: 2,
        latestLookup: { hits: 0, misses: 0, hitRate: null },
      })),
    };

    const telemetryTransport = {
      publishTelemetry: vi.fn(),
    };

    const controller = new TelemetryController(
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    expect(controller.latest("11111111-1111-1111-1111-111111111111")).toEqual(point);
    expect(controller.latest("99999999-9999-9999-9999-999999999999")).toBeNull();
    expect(telemetryState.getLatest).toHaveBeenNthCalledWith(
      1,
      "11111111-1111-1111-1111-111111111111",
    );
    expect(telemetryState.getLatest).toHaveBeenNthCalledWith(
      2,
      "99999999-9999-9999-9999-999999999999",
    );
    expect(telemetryState.trackLatestLookup).toHaveBeenNthCalledWith(1, true);
    expect(telemetryState.trackLatestLookup).toHaveBeenNthCalledWith(2, false);
  });

  it("returns telemetry stats snapshot", () => {
    const plantsService = {
      getById: vi.fn(),
    };

    const snapshot = {
      ingestCount: 14,
      cachedPlantCount: 3,
      latestLookup: {
        hits: 8,
        misses: 2,
        hitRate: 0.8,
      },
    };

    const telemetryState = {
      getAll: vi.fn(),
      getLatest: vi.fn(),
      record: vi.fn(),
      trackLatestLookup: vi.fn(),
      getStats: vi.fn(() => snapshot),
    };

    const telemetryTransport = {
      publishTelemetry: vi.fn(),
    };

    const controller = new TelemetryController(
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    expect(controller.stats()).toEqual(snapshot);
    expect(telemetryState.getStats).toHaveBeenCalledTimes(1);
  });

  it("ingests telemetry for an existing plant", () => {
    const plantsService = {
      getById: vi.fn(() => ({ id: "11111111-1111-1111-1111-111111111111" })),
    };

    const telemetryState = {
      record: vi.fn(),
      getStats: vi.fn(() => ({
        ingestCount: 1,
        cachedPlantCount: 1,
        latestLookup: { hits: 0, misses: 0, hitRate: null },
      })),
    };

    const telemetryTransport = {
      publishTelemetry: vi.fn(),
    };

    const controller = new TelemetryController(
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    const payload = {
      plantId: "11111111-1111-1111-1111-111111111111",
      moisture: 41,
      light: 260,
      temperature: 21,
      capturedAt: "2026-03-16T12:00:00.000Z",
    };

    expect(controller.ingest(payload)).toEqual({ ok: true });
    expect(plantsService.getById).toHaveBeenCalledWith(payload.plantId);
    expect(telemetryState.record).toHaveBeenCalledTimes(1);
    expect(telemetryTransport.publishTelemetry).toHaveBeenCalledTimes(1);
  });

  it("rejects telemetry for unknown plant id", () => {
    const plantsService = {
      getById: vi.fn(() => {
        throw new NotFoundException("Plant missing");
      }),
    };

    const telemetryState = {
      record: vi.fn(),
      getStats: vi.fn(() => ({
        ingestCount: 1,
        cachedPlantCount: 1,
        latestLookup: { hits: 0, misses: 0, hitRate: null },
      })),
    };

    const telemetryTransport = {
      publishTelemetry: vi.fn(),
    };

    const controller = new TelemetryController(
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    expect(() =>
      controller.ingest({
        plantId: "00000000-0000-0000-0000-000000000000",
        moisture: 10,
        light: 100,
        temperature: 19,
      }),
    ).toThrow(NotFoundException);
    expect(telemetryState.record).not.toHaveBeenCalled();
    expect(telemetryTransport.publishTelemetry).not.toHaveBeenCalled();

  });

  it("supports legacy GET /telemetry route semantics", () => {
    const point = {
      plantId: "11111111-1111-1111-1111-111111111111",
      moisture: 41,
      light: 260,
      temperature: 21,
      capturedAt: "2026-03-16T12:00:00.000Z",
    };

    const plantsService = {
      getById: vi.fn(),
    };

    const telemetryState = {
      getAll: vi.fn(),
      getLatest: vi.fn(() => point),
      record: vi.fn(),
      trackLatestLookup: vi.fn(),
      getStats: vi.fn(() => ({
        ingestCount: 1,
        cachedPlantCount: 2,
        latestLookup: { hits: 0, misses: 0, hitRate: null },
      })),
    };

    const telemetryTransport = {
      publishTelemetry: vi.fn(),
    };

    const controller = new TelemetryController(
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    expect(controller.latestCompat(point.plantId)).toEqual(point);
    expect(telemetryState.getLatest).toHaveBeenCalledWith(point.plantId);
  });

  it("supports legacy GET /telemetry/:plantId route semantics", () => {
    const point = {
      plantId: "11111111-1111-1111-1111-111111111111",
      moisture: 41,
      light: 260,
      temperature: 21,
      capturedAt: "2026-03-16T12:00:00.000Z",
    };

    const plantsService = {
      getById: vi.fn(),
    };

    const telemetryState = {
      getAll: vi.fn(),
      getLatest: vi.fn(() => point),
      record: vi.fn(),
      trackLatestLookup: vi.fn(),
      getStats: vi.fn(() => ({
        ingestCount: 1,
        cachedPlantCount: 2,
        latestLookup: { hits: 0, misses: 0, hitRate: null },
      })),
    };

    const telemetryTransport = {
      publishTelemetry: vi.fn(),
    };

    const controller = new TelemetryController(
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    expect(controller.latestByPathParam(point.plantId)).toEqual(point);
    expect(telemetryState.getLatest).toHaveBeenCalledWith(point.plantId);
    expect(telemetryState.trackLatestLookup).toHaveBeenCalledWith(true);
  });
});
