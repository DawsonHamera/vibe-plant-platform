import {
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

    const point: TelemetryPoint = {
      plantId: dto.plantId,
      moisture: dto.moisture,
      light: dto.light,
      temperature: dto.temperature,
      capturedAt: dto.capturedAt || new Date().toISOString(),
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
