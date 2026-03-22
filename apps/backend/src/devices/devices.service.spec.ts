import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { DevicesService } from "./devices.service";

type Row = {
  id: string;
  name: string;
  connection_type: "serial" | "network" | "bluetooth";
  transport_target: string;
  channel_map: string;
  calibration: string;
  plant_ids?: string;
  channel_assignments?: string;
  is_live: number;
  created_at: string;
  updated_at: string;
};

describe("DevicesService", () => {
  it("creates, lists, simulates, and toggles profile live mode", async () => {
    const rows: Row[] = [];

    const database = {
      prepare: (sql: string) => {
        if (sql.includes("INSERT INTO device_profiles")) {
          return {
            run: (...args: unknown[]) => {
              rows.push({
                id: String(args[0]),
                name: String(args[1]),
                connection_type: args[2] as Row["connection_type"],
                transport_target: String(args[3]),
                channel_map: String(args[4]),
                calibration: String(args[5]),
                plant_ids: String(args[6]),
                channel_assignments: String(args[7]),
                is_live: Number(args[8]),
                created_at: String(args[9]),
                updated_at: String(args[10]),
              });
            },
          };
        }

        if (sql.includes("SELECT * FROM device_profiles ORDER BY")) {
          return {
            all: () => [...rows],
          };
        }

        if (sql.includes("SELECT * FROM device_profiles WHERE id")) {
          return {
            get: (id: string) => rows.find((row) => row.id === id),
          };
        }

        if (sql.includes("UPDATE device_profiles SET")) {
          if (sql.includes("name = ?")) {
            return {
              run: (...args: unknown[]) => {
                const name = String(args[0]);
                const connectionType = args[1] as Row["connection_type"];
                const transportTarget = String(args[2]);
                const channelMap = String(args[3]);
                const calibration = String(args[4]);
                const plantIds = String(args[5]);
                const channelAssignments = String(args[6]);
                const isLive = Number(args[7]);
                const updatedAt = String(args[8]);
                const id = String(args[9]);
                const row = rows.find((item) => item.id === id);
                if (row) {
                  row.name = name;
                  row.connection_type = connectionType;
                  row.transport_target = transportTarget;
                  row.channel_map = channelMap;
                  row.calibration = calibration;
                  row.plant_ids = plantIds;
                  row.channel_assignments = channelAssignments;
                  row.is_live = isLive;
                  row.updated_at = updatedAt;
                }
              },
            };
          }

          return {
            run: (isLive: number, updatedAt: string, id: string) => {
              const row = rows.find((item) => item.id === id);
              if (row) {
                row.is_live = isLive;
                row.updated_at = updatedAt;
              }
            },
          };
        }

        return {
          all: () => [],
          get: () => undefined,
          run: () => undefined,
        };
      },
    };

    const sqlite = { database };
    const adapterRegistry = {
      entries: () => [
        ["serial", { discover: async () => ["COM3"] }],
        ["network", { discover: async () => ["192.168.1.12:4000"] }],
        ["bluetooth", { discover: async () => ["BT-SOIL-01"] }],
      ],
      get: () => ({
        test: async (target: string) => ({ ok: target.length > 0, latencyMs: 12, message: "ok" }),
      }),
    };
    const plantsService = {
      getById: (id: string) => ({ id }),
    };
    const telemetryState = {
      record: () => undefined,
    };
    const telemetryTransport = {
      publishTelemetry: () => undefined,
    };

    const service = new DevicesService(
      sqlite as never,
      adapterRegistry as never,
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    const discovered = await service.discover();
    expect(discovered.length).toBe(3);

    const created = service.createProfile({
      name: "Desk Sensors",
      connectionType: "serial",
      transportTarget: "COM3",
      channelMap: { moisture: "ch0", light: "ch1", temperature: "ch2" },
      calibration: { moistureDry: 900, moistureWet: 300 },
      channelAssignments: [
        {
          channel: "ch0",
          plantId: "plant-1",
          measurementType: "moisture",
          calibration: {
            inputMin: 300,
            inputMax: 900,
            clamp: true,
          },
        },
      ],
      isLive: false,
    });

    const listed = service.listProfiles();
    expect(listed.length).toBe(1);
    const first = listed[0];
    expect(first).toBeDefined();
    expect(first?.id).toBe(created.id);

    const sim = await service.simulateProfile(created.id);
    expect(sim.ok).toBe(true);

    const live = service.setProfileLiveMode(created.id, true);
    expect(live.isLive).toBe(true);

    const updated = service.updateProfile(created.id, {
      channelMap: { moisture: "a0", light: "a1", temperature: "a2" },
      calibration: { moistureDry: 820, moistureWet: 290 },
    });

    expect(updated.channelMap.moisture).toBe("a0");
    expect(updated.calibration.moistureDry).toBe(820);

    const validation = service.validateProfile(created.id);
    expect(validation.ok).toBe(true);
    expect(validation.issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("blocks live mode when profile validation has errors", () => {
    const rows: Row[] = [
      {
        id: "profile-1",
        name: "Broken Profile",
        connection_type: "serial",
        transport_target: "COM4",
        channel_map: JSON.stringify({ moisture: "", light: "", temperature: "" }),
        calibration: JSON.stringify({ moistureDry: 200, moistureWet: 300 }),
        is_live: 0,
        created_at: "2026-03-16T00:00:00.000Z",
        updated_at: "2026-03-16T00:00:00.000Z",
      },
    ];

    const database = {
      prepare: (sql: string) => {
        if (sql.includes("SELECT * FROM device_profiles WHERE id")) {
          return {
            get: (id: string) => rows.find((row) => row.id === id),
          };
        }

        if (sql.includes("UPDATE device_profiles SET")) {
          return {
            run: () => undefined,
          };
        }

        return {
          all: () => [],
          get: () => undefined,
          run: () => undefined,
        };
      },
    };

    const sqlite = { database };
    const adapterRegistry = {
      entries: () => [],
      get: () => ({
        test: async () => ({ ok: true, latencyMs: 12, message: "ok" }),
      }),
    };
    const plantsService = {
      getById: (id: string) => ({ id }),
    };
    const telemetryState = {
      record: () => undefined,
    };
    const telemetryTransport = {
      publishTelemetry: () => undefined,
    };

    const service = new DevicesService(
      sqlite as never,
      adapterRegistry as never,
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    const validation = service.validateProfile("profile-1");
    expect(validation.ok).toBe(false);
    expect(validation.issues.length).toBeGreaterThan(0);

    expect(() => service.setProfileLiveMode("profile-1", true)).toThrow(BadRequestException);
  });

  it("converts temperature values using assignment input/output units", () => {
    const rows: Row[] = [
      {
        id: "profile-temp",
        name: "Temp Profile",
        connection_type: "serial",
        transport_target: "COM6",
        channel_map: JSON.stringify({}),
        calibration: JSON.stringify({}),
        plant_ids: JSON.stringify(["plant-1"]),
        channel_assignments: JSON.stringify([
          {
            channel: "t1",
            plantId: "plant-1",
            measurementType: "temperature",
            calibration: {
              inputUnit: "fahrenheit",
              outputUnit: "celsius",
            },
          },
        ]),
        is_live: 1,
        created_at: "2026-03-16T00:00:00.000Z",
        updated_at: "2026-03-16T00:00:00.000Z",
      },
    ];

    const database = {
      prepare: (sql: string) => {
        if (sql.includes("SELECT * FROM device_profiles WHERE id")) {
          return {
            get: (id: string) => rows.find((row) => row.id === id),
          };
        }

        return {
          all: () => [],
          get: () => undefined,
          run: () => undefined,
        };
      },
    };

    const recordedPoints: Array<Record<string, unknown>> = [];
    const sqlite = { database };
    const adapterRegistry = {
      entries: () => [],
      get: () => ({
        test: async () => ({ ok: true, latencyMs: 12, message: "ok" }),
      }),
    };
    const plantsService = {
      getById: (id: string) => ({ id }),
    };
    const telemetryState = {
      record: (point: Record<string, unknown>) => recordedPoints.push(point),
    };
    const telemetryTransport = {
      publishTelemetry: () => undefined,
    };

    const service = new DevicesService(
      sqlite as never,
      adapterRegistry as never,
      plantsService as never,
      telemetryState as never,
      telemetryTransport as never,
    );

    const result = service.ingestProfileReading("profile-temp", {
      channels: {
        t1: 77,
      },
      capturedAt: "2026-03-16T00:01:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.forwardedCount).toBe(1);
    expect(result.readings[0]?.values.temperature).toBe(25);
    expect(recordedPoints.length).toBe(1);
  });
});
