import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SqliteService } from "../database/sqlite.service";
import { CreateDeviceProfileDto } from "./dto/create-device-profile.dto";
import { UpdateDeviceProfileDto } from "./dto/update-device-profile.dto";
import { DeviceAdapterRegistry } from "./adapters/device-adapter.registry";
import { AdapterTestResult } from "./adapters/device-adapter.interface";

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
  isLive: boolean;
  createdAt: string;
  updatedAt: string;
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

@Injectable()
export class DevicesService {
  constructor(
    private readonly sqlite: SqliteService,
    private readonly adapterRegistry: DeviceAdapterRegistry,
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

  listProfiles(): DeviceProfile[] {
    const stmt = this.sqlite.database.prepare(`
      SELECT * FROM device_profiles ORDER BY created_at DESC
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
      channelMap: payload.channelMap,
      calibration: payload.calibration,
      isLive: payload.isLive,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.sqlite.database.prepare(`
      INSERT INTO device_profiles (
        id, name, connection_type, transport_target,
        channel_map, calibration, is_live, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      profile.id,
      profile.name,
      profile.connectionType,
      profile.transportTarget,
      JSON.stringify(profile.channelMap),
      JSON.stringify(profile.calibration),
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

    const requiredChannels: Array<keyof DeviceProfile["channelMap"]> = [
      "moisture",
      "light",
      "temperature",
    ];

    const normalizedChannels = requiredChannels.map((key) => ({
      key,
      value: String(profile.channelMap[key] ?? "").trim(),
    }));

    normalizedChannels.forEach((entry) => {
      if (entry.value.length === 0) {
        issues.push({
          severity: "error",
          code: "CHANNEL_REQUIRED",
          message: `Channel mapping for ${entry.key} is required.`,
        });
      }
    });

    const nonEmptyValues = normalizedChannels.map((entry) => entry.value).filter((value) => value.length > 0);
    if (new Set(nonEmptyValues).size !== nonEmptyValues.length) {
      issues.push({
        severity: "warning",
        code: "CHANNEL_REUSED",
        message: "Multiple metrics are sharing the same channel mapping.",
      });
    }

    const moistureDry = Number(profile.calibration.moistureDry);
    const moistureWet = Number(profile.calibration.moistureWet);

    if (!Number.isFinite(moistureDry) || !Number.isFinite(moistureWet)) {
      issues.push({
        severity: "error",
        code: "CALIBRATION_REQUIRED",
        message: "Moisture dry and wet calibration values are required.",
      });
    } else {
      if (moistureDry <= moistureWet) {
        issues.push({
          severity: "error",
          code: "CALIBRATION_ORDER",
          message: "Moisture dry calibration must be greater than moisture wet calibration.",
        });
      }

      if (moistureDry - moistureWet < 100) {
        issues.push({
          severity: "warning",
          code: "CALIBRATION_RANGE_NARROW",
          message: "Moisture dry/wet calibration range is narrow; sensor normalization may be unstable.",
        });
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
    const channelMap = JSON.stringify(payload.channelMap ?? profile.channelMap);
    const calibration = JSON.stringify(payload.calibration ?? profile.calibration);
    const isLive = payload.isLive !== undefined ? (payload.isLive ? 1 : 0) : profile.isLive ? 1 : 0;

    const stmt = this.sqlite.database.prepare(`
      UPDATE device_profiles SET
        name = ?,
        channel_map = ?,
        calibration = ?,
        is_live = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(name, channelMap, calibration, isLive, updatedAt, id);
    return { ...profile, ...payload, updatedAt };
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
      isLive: Number(row.is_live) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
