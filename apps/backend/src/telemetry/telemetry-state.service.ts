import { Injectable } from "@nestjs/common";
import type { TelemetryPoint } from "@vibe/shared";

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

  record(point: TelemetryPoint): void {
    this.ingestCount += 1;
    this.latestByPlant.set(point.plantId, point);
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
}
