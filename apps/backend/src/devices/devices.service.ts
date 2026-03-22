import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { TelemetryPoint } from "@vibe/shared";
import { randomUUID } from "node:crypto";
import { SqliteService } from "../database/sqlite.service";
import { PlantsService } from "../plants/plants.service";
import { TelemetryStateService } from "../telemetry/telemetry-state.service";
import { TelemetryTransportService } from "../telemetry/telemetry-transport.service";
import { CreateDeviceProfileDto } from "./dto/create-device-profile.dto";
import { IngestDeviceReadingDto } from "./dto/ingest-device-reading.dto";
import { UpdateDeviceProfileDto } from "./dto/update-device-profile.dto";
import { DeviceAdapterRegistry } from "./adapters/device-adapter.registry";
import {
  AdapterChannelProbeResult,
  AdapterTestResult,
} from "./adapters/device-adapter.interface";

type DeviceDiscovery = {
  connectionType: "serial" | "network" | "bluetooth";
  options: string[];
};

export type DeviceProfile = {
  id: string;
  name: string;
  connectionType: "serial" | "network" | "bluetooth";
  transportTarget: string;
  channelMap: Record<string, string>;
  calibration: Record<string, number>;
  plantIds: string[];
  channelAssignments: DeviceChannelAssignment[];
  isLive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DeviceMeasurementType =
  | "moisture"
  | "temperature"
  | "light"
  | "humidity"
  | "reservoirLevel";

type DeviceTemperatureUnit = "celsius" | "fahrenheit";

export type DeviceChannelAssignment = {
  channel: string;
  plantId?: string;
  measurementType?: DeviceMeasurementType;
  ioType?: "input" | "output";
  outputLabel?: string;
  calibration?: {
    inputMin?: number;
    inputMax?: number;
    clamp?: boolean;
    inputUnit?: DeviceTemperatureUnit;
    outputUnit?: DeviceTemperatureUnit;
  };
};

export type DeviceProfileValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type DeviceProfileValidationResult = {
  ok: boolean;
  issues: DeviceProfileValidationIssue[];
};

export type DeviceProfileReadingResult = {
  ok: boolean;
  profileId: string;
  forwardedCount: number;
  readings: Array<{
    plantId: string;
    values: {
      moisture?: number;
      light?: number;
      temperature?: number;
      humidity?: number;
      reservoirLevel?: number;
    };
    capturedAt: string;
  }>;
};

export type LiveProfilePollResult = {
  checkedProfiles: number;
  ingestedProfiles: number;
  forwardedReadings: number;
};

type AssignmentTelemetryValues = Pick<
  TelemetryPoint,
  "moisture" | "light" | "temperature" | "humidity" | "reservoirLevel"
>;

@Injectable()
export class DevicesService {
  private readonly liveRawChannelsByProfile = new Map<
    string,
    { channels: Record<string, number>; capturedAt: string }
  >();

  constructor(
    private readonly sqlite: SqliteService,
    private readonly adapterRegistry: DeviceAdapterRegistry,
    private readonly plantsService: PlantsService,
    private readonly telemetryState: TelemetryStateService,
    private readonly telemetryTransport: TelemetryTransportService,
  ) {}

  async discover(): Promise<DeviceDiscovery[]> {
    const discovered = await Promise.all(
      this.adapterRegistry.entries().map(async ([connectionType, adapter]) => ({
        connectionType,
        options: await adapter.discover(),
      })),
    );
    return discovered;
  }

  async testConnection(
    connectionType: DeviceProfile["connectionType"],
    target: string,
  ): Promise<AdapterTestResult> {
    const adapter = this.adapterRegistry.get(connectionType);
    return adapter.test(target);
  }

  async probeChannels(
    connectionType: DeviceProfile["connectionType"],
    target: string,
  ): Promise<AdapterChannelProbeResult> {
    const adapter = this.adapterRegistry.get(connectionType);
    return adapter.probeChannels(target);
  }

  getLiveChannelsForProfile(id: string): AdapterChannelProbeResult {
    const profile = this.getProfileById(id);
    if (!profile.isLive) {
      return {
        ok: false,
        channels: [],
        message: "Profile is not in live mode.",
      };
    }

    const snapshot = this.liveRawChannelsByProfile.get(id);
    if (!snapshot) {
      return {
        ok: false,
        channels: [],
        message: "No live raw payload received yet. Wait for stream data or run a direct probe.",
      };
    }

    const channels = Object.keys(snapshot.channels);
    return {
      ok: channels.length > 0,
      channels,
      message:
        channels.length > 0
          ? `Detected ${channels.length} channel(s) from live stream.`
          : "Live payload received but no numeric channels were found.",
      sample: JSON.stringify({ channels: snapshot.channels, capturedAt: snapshot.capturedAt }),
    };
  }

  listProfiles(): DeviceProfile[] {
    const stmt = this.sqlite.database.prepare(`
      SELECT * FROM device_profiles ORDER BY created_at DESC
    `);

    return stmt.all().map((row) => this.mapRow(row as Record<string, unknown>));
  }

  listLiveProfiles(): DeviceProfile[] {
    const stmt = this.sqlite.database.prepare(`
      SELECT * FROM device_profiles WHERE is_live = 1 ORDER BY updated_at DESC
    `);

    return stmt.all().map((row) => this.mapRow(row as Record<string, unknown>));
  }

  createProfile(payload: CreateDeviceProfileDto): DeviceProfile {
    const now = new Date().toISOString();
    const profile: DeviceProfile = {
      id: randomUUID(),
      name: payload.name,
      connectionType: payload.connectionType,
      transportTarget: payload.transportTarget,
      channelMap: payload.channelMap ?? {},
      calibration: payload.calibration ?? {},
      plantIds: payload.plantIds ?? [],
      channelAssignments: this.normalizeAssignments(payload.channelAssignments),
      isLive: payload.isLive,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.sqlite.database.prepare(`
      INSERT INTO device_profiles (
        id, name, connection_type, transport_target,
        channel_map, calibration, plant_ids, channel_assignments, is_live, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      profile.id,
      profile.name,
      profile.connectionType,
      profile.transportTarget,
      JSON.stringify(profile.channelMap),
      JSON.stringify(profile.calibration),
      JSON.stringify(profile.plantIds),
      JSON.stringify(profile.channelAssignments),
      profile.isLive ? 1 : 0,
      profile.createdAt,
      profile.updatedAt,
    );

    return profile;
  }

  setProfileLiveMode(id: string, isLive: boolean): DeviceProfile {
    const profile = this.getProfileById(id);
    if (isLive) {
      const validation = this.validateProfile(id);
      if (!validation.ok) {
        const summary = validation.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.message)
          .join(", ");
        throw new BadRequestException(
          `Cannot enable live mode until profile validation passes: ${summary}`,
        );
      }
    }

    const updatedAt = new Date().toISOString();
    const stmt = this.sqlite.database.prepare(`
      UPDATE device_profiles SET
        is_live = ?,
        updated_at = ?
      WHERE id = ?
    `);
    stmt.run(isLive ? 1 : 0, updatedAt, id);
    if (!isLive) {
      this.liveRawChannelsByProfile.delete(id);
    }
    return { ...profile, isLive, updatedAt };
  }

  async simulateProfile(id: string): Promise<{ ok: boolean; message: string }> {
    const profile = this.getProfileById(id);
    const probe = await this.testConnection(profile.connectionType, profile.transportTarget);
    return {
      ok: probe.ok,
      message: probe.ok
        ? `Simulation succeeded for ${profile.name}`
        : `Simulation failed for ${profile.name}: ${probe.message}`,
    };
  }

  validateProfile(id: string): DeviceProfileValidationResult {
    const profile = this.getProfileById(id);
    const issues: DeviceProfileValidationIssue[] = [];

    const assignments = profile.channelAssignments;
    if (assignments.length === 0) {
      issues.push({
        severity: "error",
        code: "CHANNEL_ASSIGNMENT_REQUIRED",
        message: "At least one channel assignment is required.",
      });
    }

    const assignmentSignatures = assignments.map((assignment) => {
      const ioType = assignment.ioType ?? "input";
      if (ioType === "output") {
        return `output::${assignment.channel.trim().toLowerCase()}`;
      }

      return `${assignment.channel.trim().toLowerCase()}::${String(assignment.plantId ?? "")}::${String(
        assignment.measurementType ?? "",
      )}`;
    });
    if (new Set(assignmentSignatures).size !== assignmentSignatures.length) {
      issues.push({
        severity: "warning",
        code: "ASSIGNMENT_DUPLICATE",
        message: "Some channel assignments are duplicated for the same plant and measurement type.",
      });
    }

    for (const assignment of assignments) {
      const ioType = assignment.ioType ?? "input";

      if (!assignment.channel || assignment.channel.trim().length === 0) {
        issues.push({
          severity: "error",
          code: "ASSIGNMENT_CHANNEL_REQUIRED",
          message: "Every assignment must include a channel label.",
        });
      }

      if (ioType === "output") {
        if (!assignment.outputLabel || assignment.outputLabel.trim().length === 0) {
          issues.push({
            severity: "warning",
            code: "OUTPUT_LABEL_RECOMMENDED",
            message: `Output assignment on ${assignment.channel} should include an output label for flow actions.`,
          });
        }

        continue;
      }

      if (!assignment.plantId || !assignment.measurementType) {
        issues.push({
          severity: "error",
          code: "ASSIGNMENT_INPUT_INCOMPLETE",
          message: `Input assignment on ${assignment.channel} must include plant and measurement type.`,
        });
        continue;
      }

      try {
        this.plantsService.getById(assignment.plantId);
      } catch {
        issues.push({
          severity: "error",
          code: "ASSIGNMENT_PLANT_INVALID",
          message: `Assigned plant ${assignment.plantId} does not exist.`,
        });
      }

      if (assignment.measurementType === "moisture") {
        const min = assignment.calibration?.inputMin;
        const max = assignment.calibration?.inputMax;
        if ((min === undefined) !== (max === undefined)) {
          issues.push({
            severity: "warning",
            code: "CALIBRATION_PARTIAL",
            message: `Moisture assignment on ${assignment.channel} should include both calibration min and max.`,
          });
        }

        if (min !== undefined && max !== undefined && min >= max) {
          issues.push({
            severity: "error",
            code: "CALIBRATION_RANGE_INVALID",
            message: `Calibration min must be less than max for channel ${assignment.channel}.`,
          });
        }
      } else if (assignment.measurementType === "temperature") {
        const inputUnit = assignment.calibration?.inputUnit;
        const outputUnit = assignment.calibration?.outputUnit;
        const isValidUnit = (value: string | undefined): boolean =>
          value === undefined || value === "celsius" || value === "fahrenheit";

        if (!isValidUnit(inputUnit) || !isValidUnit(outputUnit)) {
          issues.push({
            severity: "error",
            code: "TEMPERATURE_UNIT_INVALID",
            message: `Temperature assignment on ${assignment.channel} must use celsius or fahrenheit units.`,
          });
        }
      }
    }

    return {
      ok: issues.every((issue) => issue.severity !== "error"),
      issues,
    };
  }

  updateProfile(id: string, payload: UpdateDeviceProfileDto): DeviceProfile {
    const profile = this.getProfileById(id);
    const updatedAt = new Date().toISOString();
    const name = payload.name ?? profile.name;
    const connectionType = payload.connectionType ?? profile.connectionType;
    const transportTarget = payload.transportTarget ?? profile.transportTarget;
    const channelMap = JSON.stringify(payload.channelMap ?? profile.channelMap);
    const calibration = JSON.stringify(payload.calibration ?? profile.calibration);
    const plantIds = JSON.stringify(payload.plantIds ?? profile.plantIds);
    const nextAssignments =
      payload.channelAssignments !== undefined
        ? this.normalizeAssignments(payload.channelAssignments)
        : profile.channelAssignments;
    const channelAssignments = JSON.stringify(nextAssignments);
    const isLive = payload.isLive !== undefined ? (payload.isLive ? 1 : 0) : profile.isLive ? 1 : 0;

    const stmt = this.sqlite.database.prepare(`
      UPDATE device_profiles SET
        name = ?,
        connection_type = ?,
        transport_target = ?,
        channel_map = ?,
        calibration = ?,
        plant_ids = ?,
        channel_assignments = ?,
        is_live = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      name,
      connectionType,
      transportTarget,
      channelMap,
      calibration,
      plantIds,
      channelAssignments,
      isLive,
      updatedAt,
      id,
    );
    return {
      ...profile,
      name,
      connectionType,
      transportTarget,
      channelMap: payload.channelMap ?? profile.channelMap,
      calibration: payload.calibration ?? profile.calibration,
      plantIds: payload.plantIds ?? profile.plantIds,
      channelAssignments: nextAssignments,
      isLive: Boolean(isLive),
      updatedAt,
    };
  }

  ingestProfileReading(id: string, payload: IngestDeviceReadingDto): DeviceProfileReadingResult {
    const profile = this.getProfileById(id);
    const capturedAt = payload.capturedAt || new Date().toISOString();
    const normalizedChannels = payload.channels ?? {};

    const assignments = profile.channelAssignments;
    if (assignments.length === 0) {
      return {
        ok: false,
        profileId: profile.id,
        forwardedCount: 0,
        readings: [],
      };
    }

    const pointsByPlant = new Map<string, TelemetryPoint>();
    for (const assignment of assignments) {
      if ((assignment.ioType ?? "input") === "output") {
        continue;
      }

      if (!assignment.plantId || !assignment.measurementType) {
        continue;
      }

      const rawValue = Number(normalizedChannels[assignment.channel]);
      if (!Number.isFinite(rawValue)) {
        continue;
      }

      this.plantsService.getById(assignment.plantId);
      const nextValue = this.applyCalibration(assignment, rawValue);

      const current =
        pointsByPlant.get(assignment.plantId) ??
        ({
          plantId: assignment.plantId,
          capturedAt,
          sourceProfileId: profile.id,
          sourceProfileName: profile.name,
        } as TelemetryPoint);

      this.assignMeasurement(current, assignment.measurementType, nextValue);
      pointsByPlant.set(assignment.plantId, current);
    }

    if (pointsByPlant.size === 0) {
      return {
        ok: true,
        profileId: profile.id,
        forwardedCount: 0,
        readings: [],
      };
    }

    const readings: DeviceProfileReadingResult["readings"] = [];
    for (const [plantId, point] of pointsByPlant.entries()) {

      this.telemetryState.record(point);
      this.telemetryTransport.publishTelemetry(point);
      readings.push({
        plantId,
        values: {
          ...(point.moisture !== undefined ? { moisture: point.moisture } : {}),
          ...(point.light !== undefined ? { light: point.light } : {}),
          ...(point.temperature !== undefined ? { temperature: point.temperature } : {}),
          ...(point.humidity !== undefined ? { humidity: point.humidity } : {}),
          ...(point.reservoirLevel !== undefined ? { reservoirLevel: point.reservoirLevel } : {}),
        },
        capturedAt,
      });
    }

    return {
      ok: true,
      profileId: profile.id,
      forwardedCount: readings.length,
      readings,
    };
  }

  async pollLiveProfilesFromAdapters(): Promise<LiveProfilePollResult> {
    const profiles = this.listLiveProfiles();
    let ingestedProfiles = 0;
    let forwardedReadings = 0;

    for (const profile of profiles) {
      try {
        const adapter = this.adapterRegistry.get(profile.connectionType);
        const probe = await adapter.probeChannels(profile.transportTarget);
        if (!probe.ok || !probe.sample) {
          continue;
        }

        const channels = this.extractChannelsFromSample(probe.sample);
        if (Object.keys(channels).length === 0) {
          continue;
        }

        this.liveRawChannelsByProfile.set(profile.id, {
          channels,
          capturedAt: new Date().toISOString(),
        });

        const ingest = this.ingestProfileReading(profile.id, {
          channels,
          capturedAt: new Date().toISOString(),
        });

        if (ingest.forwardedCount > 0) {
          ingestedProfiles += 1;
          forwardedReadings += ingest.forwardedCount;
        }
      } catch {
        // Ignore adapter/profile errors so one faulty profile does not block all live profiles.
      }
    }

    return {
      checkedProfiles: profiles.length,
      ingestedProfiles,
      forwardedReadings,
    };
  }

  deleteProfile(id: string): { ok: boolean; deletedId: string } {
    const stmt = this.sqlite.database.prepare("DELETE FROM device_profiles WHERE id = ?");
    const result = stmt.run(id);

    if (result.changes === 0) {
      throw new NotFoundException(`Device profile ${id} was not found`);
    }

    this.liveRawChannelsByProfile.delete(id);

    return {
      ok: true,
      deletedId: id,
    };
  }

  deleteAllProfiles(): { ok: boolean; deletedCount: number } {
    const stmt = this.sqlite.database.prepare("DELETE FROM device_profiles");
    const result = stmt.run();
    this.liveRawChannelsByProfile.clear();

    return {
      ok: true,
      deletedCount: Number(result.changes ?? 0),
    };
  }

  private getProfileById(id: string): DeviceProfile {
    const stmt = this.sqlite.database.prepare("SELECT * FROM device_profiles WHERE id = ?");
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new NotFoundException(`Device profile ${id} was not found`);
    }

    return this.mapRow(row);
  }

  private mapRow(row: Record<string, unknown>): DeviceProfile {
    return {
      id: String(row.id),
      name: String(row.name),
      connectionType: row.connection_type as DeviceProfile["connectionType"],
      transportTarget: String(row.transport_target),
      channelMap: JSON.parse(String(row.channel_map)) as Record<string, string>,
      calibration: JSON.parse(String(row.calibration)) as Record<string, number>,
      plantIds: JSON.parse(String(row.plant_ids ?? "[]")) as string[],
      channelAssignments: this.normalizeAssignments(
        JSON.parse(String(row.channel_assignments ?? "[]")) as Array<Record<string, unknown>>,
      ),
      isLive: Number(row.is_live) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapChannelsToTelemetry(
    profile: DeviceProfile,
    channels: Record<string, number>,
  ): { moisture?: number; light?: number; temperature?: number } {
    const moistureChannel = (profile.channelMap.moisture ?? "").trim();
    const lightChannel = (profile.channelMap.light ?? "").trim();
    const temperatureChannel = (profile.channelMap.temperature ?? "").trim();

    const moistureRaw = moistureChannel ? Number(channels[moistureChannel]) : Number.NaN;
    const lightRaw = lightChannel ? Number(channels[lightChannel]) : Number.NaN;
    const temperatureRaw = temperatureChannel ? Number(channels[temperatureChannel]) : Number.NaN;

    const mapped: { moisture?: number; light?: number; temperature?: number } = {};

    if (Number.isFinite(moistureRaw)) {
      const dry = Number(profile.calibration.moistureDry);
      const wet = Number(profile.calibration.moistureWet);
      if (Number.isFinite(dry) && Number.isFinite(wet) && dry > wet) {
        const normalized = ((dry - moistureRaw) / (dry - wet)) * 100;
        mapped.moisture = Math.max(0, Math.min(100, Math.round(normalized * 10) / 10));
      } else {
        mapped.moisture = Math.round(moistureRaw * 10) / 10;
      }
    }

    if (Number.isFinite(lightRaw)) {
      mapped.light = Math.round(lightRaw * 10) / 10;
    }

    if (Number.isFinite(temperatureRaw)) {
      mapped.temperature = Math.round(temperatureRaw * 10) / 10;
    }

    return mapped;
  }

  private normalizeAssignments(
    value: Array<Record<string, unknown>> | undefined,
  ): DeviceChannelAssignment[] {
    const source = Array.isArray(value) ? value : [];
    const allowedTypes: DeviceMeasurementType[] = [
      "moisture",
      "temperature",
      "light",
      "humidity",
      "reservoirLevel",
    ];

    return source
      .map((raw) => {
        const measurementType = String(raw.measurementType ?? "").trim() as DeviceMeasurementType;
        const calibrationRaw = raw.calibration;
        const calibration =
          calibrationRaw && typeof calibrationRaw === "object" && !Array.isArray(calibrationRaw)
            ? {
                ...(Number.isFinite(Number((calibrationRaw as Record<string, unknown>).inputMin))
                  ? { inputMin: Number((calibrationRaw as Record<string, unknown>).inputMin) }
                  : {}),
                ...(Number.isFinite(Number((calibrationRaw as Record<string, unknown>).inputMax))
                  ? { inputMax: Number((calibrationRaw as Record<string, unknown>).inputMax) }
                  : {}),
                ...(typeof (calibrationRaw as Record<string, unknown>).clamp === "boolean"
                  ? { clamp: (calibrationRaw as Record<string, unknown>).clamp as boolean }
                  : {}),
                ...(["celsius", "fahrenheit"].includes(
                  String((calibrationRaw as Record<string, unknown>).inputUnit ?? "").toLowerCase(),
                )
                  ? {
                      inputUnit: String(
                        (calibrationRaw as Record<string, unknown>).inputUnit,
                      ).toLowerCase() as DeviceTemperatureUnit,
                    }
                  : {}),
                ...(["celsius", "fahrenheit"].includes(
                  String((calibrationRaw as Record<string, unknown>).outputUnit ?? "").toLowerCase(),
                )
                  ? {
                      outputUnit: String(
                        (calibrationRaw as Record<string, unknown>).outputUnit,
                      ).toLowerCase() as DeviceTemperatureUnit,
                    }
                  : {}),
              }
            : undefined;

        return {
          channel: String(raw.channel ?? "").trim(),
          ...(typeof raw.plantId === "string" && String(raw.plantId).trim().length > 0
            ? { plantId: String(raw.plantId).trim() }
            : {}),
          ...(allowedTypes.includes(measurementType) ? { measurementType } : {}),
          ...(String(raw.ioType ?? "input").toLowerCase() === "output"
            ? { ioType: "output" as const }
            : { ioType: "input" as const }),
          ...(typeof raw.outputLabel === "string" && String(raw.outputLabel).trim().length > 0
            ? { outputLabel: String(raw.outputLabel).trim() }
            : {}),
          ...(calibration ? { calibration } : {}),
        };
      })
      .filter(
        (assignment) =>
          assignment.channel.length > 0 &&
          ((assignment.ioType ?? "input") === "output" ||
            (Boolean(assignment.plantId) &&
              Boolean(assignment.measurementType) &&
              allowedTypes.includes(assignment.measurementType as DeviceMeasurementType))),
      );
  }

  private applyCalibration(assignment: DeviceChannelAssignment, rawValue: number): number {
    const min = assignment.calibration?.inputMin;
    const max = assignment.calibration?.inputMax;
    const shouldClamp = assignment.calibration?.clamp !== false;

    if (assignment.measurementType === "temperature") {
      const inputUnit = assignment.calibration?.inputUnit ?? "celsius";
      const outputUnit = assignment.calibration?.outputUnit ?? "celsius";
      let temperature = rawValue;

      if (inputUnit !== outputUnit) {
        if (inputUnit === "fahrenheit" && outputUnit === "celsius") {
          temperature = ((rawValue - 32) * 5) / 9;
        } else if (inputUnit === "celsius" && outputUnit === "fahrenheit") {
          temperature = (rawValue * 9) / 5 + 32;
        }
      }

      return Math.round(temperature * 10) / 10;
    }

    if (assignment.measurementType !== "moisture") {
      return Math.round(rawValue * 10) / 10;
    }

    if (min === undefined || max === undefined || min >= max) {
      return Math.round(rawValue * 10) / 10;
    }

    const normalized = ((max - rawValue) / (max - min)) * 100;
    const adjusted = shouldClamp ? Math.max(0, Math.min(100, normalized)) : normalized;
    return Math.round(adjusted * 10) / 10;
  }

  private assignMeasurement(
    point: TelemetryPoint,
    measurementType: DeviceMeasurementType,
    value: number,
  ): void {
    const typedPoint = point as TelemetryPoint & AssignmentTelemetryValues;
    switch (measurementType) {
      case "moisture":
        typedPoint.moisture = value;
        return;
      case "light":
        typedPoint.light = value;
        return;
      case "temperature":
        typedPoint.temperature = value;
        return;
      case "humidity":
        typedPoint.humidity = value;
        return;
      case "reservoirLevel":
        typedPoint.reservoirLevel = value;
        return;
    }
  }

  private extractChannelsFromSample(sample: string): Record<string, number> {
    const lines = sample
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;

        if (parsed.channels && typeof parsed.channels === "object" && !Array.isArray(parsed.channels)) {
          return Object.fromEntries(
            Object.entries(parsed.channels as Record<string, unknown>)
              .map(([key, value]) => [key, Number(value)] as const)
              .filter(([, value]) => Number.isFinite(value)),
          );
        }

        const topLevel = Object.fromEntries(
          Object.entries(parsed)
            .map(([key, value]) => [key, Number(value)] as const)
            .filter(([, value]) => Number.isFinite(value)),
        );
        if (Object.keys(topLevel).length > 0) {
          return topLevel;
        }
      } catch {
        // Continue scanning lines until valid JSON channel payload is found.
      }
    }

    return {};
  }
}
