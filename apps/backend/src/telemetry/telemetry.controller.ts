import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import type { TelemetryPoint } from "@vibe/shared";
import { PlantsService } from "../plants/plants.service";
import { CreateTelemetryDto } from "./dto/create-telemetry.dto";
import { TelemetryTransportService } from "./telemetry-transport.service";
import { TelemetryStateService } from "./telemetry-state.service";

@Controller("telemetry")
export class TelemetryController {
  private readonly logger = new Logger(TelemetryController.name);

  constructor(
    private readonly plantsService: PlantsService,
    private readonly telemetryState: TelemetryStateService,
    private readonly telemetryTransport: TelemetryTransportService,
  ) {}

  @Get()
  latestCompat(
    @Query("plantId") plantId?: string,
    @Query("limit") limit?: string,
  ): TelemetryPoint[] | TelemetryPoint | null {
    return this.latest(plantId, limit);
  }

  @Get("latest")
  latest(
    @Query("plantId") plantId?: string,
    @Query("limit") limit?: string,
  ): TelemetryPoint[] | TelemetryPoint | null {
    if (plantId) {
      const point = this.telemetryState.getLatest(plantId);
      this.telemetryState.trackLatestLookup(Boolean(point));
      return point ?? null;
    }

    const allPoints = this.telemetryState
      .getAll()
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

    if (!limit) {
      return allPoints;
    }

    const parsedLimit = Number.parseInt(limit, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return allPoints;
    }

    return allPoints.slice(0, Math.min(parsedLimit, 200));
  }

  @Get("stats")
  stats(): {
    ingestCount: number;
    cachedPlantCount: number;
    latestLookup: {
      hits: number;
      misses: number;
      hitRate: number | null;
    };
  } {
    return this.telemetryState.getStats();
  }

  @Get("history")
  history(
    @Query("range") range?: "day" | "week" | "month" | "year",
    @Query("plantId") plantId?: string,
    @Query("plantIds") plantIds?: string,
    @Query("limit") limit?: string,
  ): TelemetryPoint[] {
    const span = range ?? "day";
    const now = Date.now();
    const spanMsByRange = {
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 31 * 24 * 60 * 60 * 1000,
      year: 366 * 24 * 60 * 60 * 1000,
    } as const;

    const sinceIso = new Date(now - spanMsByRange[span]).toISOString();
    const defaultLimitByRange = {
      day: 2_500,
      week: 8_000,
      month: 15_000,
      year: 40_000,
    } as const;

    const parsedLimit = Number.parseInt(limit ?? "", 10);
    const queryLimit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(parsedLimit, 50_000))
      : defaultLimitByRange[span];

    const requestedPlantIds = [
      ...(plantId ? [plantId] : []),
      ...(plantIds
        ? plantIds
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : []),
    ];
    const uniquePlantIds = Array.from(new Set(requestedPlantIds));

    return this.telemetryState.getHistory({
      sinceIso,
      limit: queryLimit,
      ...(uniquePlantIds.length > 0 ? { plantIds: uniquePlantIds } : {}),
    });
  }

  @Get(":plantId")
  latestByPathParam(
    @Param("plantId", new ParseUUIDPipe({ version: "4" })) plantId: string,
  ): TelemetryPoint | null {
    // Compatibility route for older clients that requested /telemetry/:plantId.
    const point = this.telemetryState.getLatest(plantId);
    this.telemetryState.trackLatestLookup(Boolean(point));
    return point ?? null;
  }

  @Post("ingest")
  @HttpCode(202)
  ingest(@Body() dto: CreateTelemetryDto): { ok: boolean } {
    this.plantsService.getById(dto.plantId);

    const hasAnyMeasurement =
      dto.moisture !== undefined ||
      dto.light !== undefined ||
      dto.temperature !== undefined ||
      dto.humidity !== undefined ||
      dto.reservoirLevel !== undefined;
    if (!hasAnyMeasurement) {
      throw new BadRequestException(
        "Telemetry payload must include at least one measurement (moisture, light, temperature, humidity, reservoirLevel).",
      );
    }

    const point: TelemetryPoint = {
      plantId: dto.plantId,
      capturedAt: dto.capturedAt || new Date().toISOString(),
      ...(dto.moisture !== undefined ? { moisture: dto.moisture } : {}),
      ...(dto.light !== undefined ? { light: dto.light } : {}),
      ...(dto.temperature !== undefined ? { temperature: dto.temperature } : {}),
      ...(dto.humidity !== undefined ? { humidity: dto.humidity } : {}),
      ...(dto.reservoirLevel !== undefined ? { reservoirLevel: dto.reservoirLevel } : {}),
    };

    this.telemetryState.record(point);
    this.telemetryTransport.publishTelemetry(point);
    const stats = this.telemetryState.getStats();
    if (stats.ingestCount % 50 === 0) {
      this.logger.log(
        `telemetry_ingest_volume count=${stats.ingestCount} cacheSize=${stats.cachedPlantCount} latestHitRate=${stats.latestLookup.hitRate ?? "n/a"}`,
      );
    }

    return { ok: true };
  }
}
