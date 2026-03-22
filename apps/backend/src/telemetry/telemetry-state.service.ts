import { Injectable, Optional } from "@nestjs/common";
import type { TelemetryPoint } from "@vibe/shared";
import { randomUUID } from "node:crypto";
import { SqliteService } from "../database/sqlite.service";

type TelemetryStats = {
  ingestCount: number;
  cachedPlantCount: number;
  latestLookup: {
    hits: number;
    misses: number;
    hitRate: number | null;
  };
};

@Injectable()
export class TelemetryStateService {
  private readonly latestByPlant = new Map<string, TelemetryPoint>();
  private ingestCount = 0;
  private latestLookupHits = 0;
  private latestLookupMisses = 0;

  constructor(@Optional() private readonly sqlite?: SqliteService) {}

  record(point: TelemetryPoint): void {
    this.ingestCount += 1;
    this.latestByPlant.set(point.plantId, point);
    this.persistHistory(point);
  }

  getLatest(plantId: string): TelemetryPoint | undefined {
    return this.latestByPlant.get(plantId);
  }

  trackLatestLookup(found: boolean): void {
    if (found) {
      this.latestLookupHits += 1;
      return;
    }

    this.latestLookupMisses += 1;
  }

  getAll(): TelemetryPoint[] {
    return Array.from(this.latestByPlant.values());
  }

  getHistory(options: {
    sinceIso: string;
    limit: number;
    plantIds?: string[];
  }): TelemetryPoint[] {
    if (!this.sqlite) {
      return this.getAll()
        .filter((point) => point.capturedAt >= options.sinceIso)
        .filter((point) => !options.plantIds || options.plantIds.length === 0 || options.plantIds.includes(point.plantId))
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
        .slice(-Math.max(1, Math.min(options.limit, 50_000)));
    }

    const cappedLimit = Math.max(1, Math.min(options.limit, 50_000));
    const normalizedPlantIds = (options.plantIds ?? []).filter((entry) => entry.trim().length > 0);
    const whereClauses = ["captured_at >= ?"];
    const params: Array<string | number> = [options.sinceIso];

    if (normalizedPlantIds.length > 0) {
      whereClauses.push(`plant_id IN (${normalizedPlantIds.map(() => "?").join(",")})`);
      params.push(...normalizedPlantIds);
    }

    params.push(cappedLimit);

    const statement = this.sqlite.database.prepare(`
      SELECT
        plant_id,
        moisture,
        light,
        temperature,
        humidity,
        reservoir_level,
        captured_at,
        source_profile_id,
        source_profile_name
      FROM telemetry_history
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY captured_at ASC
      LIMIT ?
    `);

    const rows = statement.all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      plantId: String(row.plant_id),
      ...(row.moisture === null || row.moisture === undefined ? {} : { moisture: Number(row.moisture) }),
      ...(row.light === null || row.light === undefined ? {} : { light: Number(row.light) }),
      ...(row.temperature === null || row.temperature === undefined ? {} : { temperature: Number(row.temperature) }),
      ...(row.humidity === null || row.humidity === undefined ? {} : { humidity: Number(row.humidity) }),
      ...(row.reservoir_level === null || row.reservoir_level === undefined
        ? {}
        : { reservoirLevel: Number(row.reservoir_level) }),
      capturedAt: String(row.captured_at),
      ...(typeof row.source_profile_id === "string" ? { sourceProfileId: row.source_profile_id } : {}),
      ...(typeof row.source_profile_name === "string" ? { sourceProfileName: row.source_profile_name } : {}),
    }));
  }

  getStats(): TelemetryStats {
    const totalLookups = this.latestLookupHits + this.latestLookupMisses;

    return {
      ingestCount: this.ingestCount,
      cachedPlantCount: this.latestByPlant.size,
      latestLookup: {
        hits: this.latestLookupHits,
        misses: this.latestLookupMisses,
        hitRate: totalLookups > 0 ? this.latestLookupHits / totalLookups : null,
      },
    };
  }

  private persistHistory(point: TelemetryPoint): void {
    if (!this.sqlite) {
      return;
    }

    const statement = this.sqlite.database.prepare(`
      INSERT INTO telemetry_history (
        id,
        plant_id,
        moisture,
        light,
        temperature,
        humidity,
        reservoir_level,
        captured_at,
        source_profile_id,
        source_profile_name,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    statement.run(
      randomUUID(),
      point.plantId,
      point.moisture ?? null,
      point.light ?? null,
      point.temperature ?? null,
      point.humidity ?? null,
      point.reservoirLevel ?? null,
      point.capturedAt,
      point.sourceProfileId ?? null,
      point.sourceProfileName ?? null,
      new Date().toISOString(),
    );
  }
}
