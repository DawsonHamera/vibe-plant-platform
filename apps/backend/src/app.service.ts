import { Injectable } from "@nestjs/common";
import { SqliteService } from "./database/sqlite.service";

export type HealthDetails = {
  status: "ok" | "degraded";
  startedAt: string;
  uptimeSeconds: number;
  database: {
    ok: boolean;
    plantsCount: number;
    deviceProfilesCount: number;
    automationRulesCount: number;
    automationEventsCount: number;
    error?: string;
  };
};

@Injectable()
export class AppService {
  private readonly startedAt = new Date();

  constructor(private readonly sqlite: SqliteService) {}

  getHealth(): { status: string } {
    return { status: "ok" };
  }

  getHealthDetails(): HealthDetails {
    const uptimeSeconds = Math.max(0, Math.floor((Date.now() - this.startedAt.getTime()) / 1000));

    try {
      const readCount = (table: string): number => {
        const stmt = this.sqlite.database.prepare(`SELECT COUNT(*) as count FROM ${table}`);
        const row = stmt.get() as { count: number } | undefined;
        return Number(row?.count ?? 0);
      };

      return {
        status: "ok",
        startedAt: this.startedAt.toISOString(),
        uptimeSeconds,
        database: {
          ok: true,
          plantsCount: readCount("plants"),
          deviceProfilesCount: readCount("device_profiles"),
          automationRulesCount: readCount("automation_rules"),
          automationEventsCount: readCount("automation_events"),
        },
      };
    } catch (error) {
      return {
        status: "degraded",
        startedAt: this.startedAt.toISOString(),
        uptimeSeconds,
        database: {
          ok: false,
          plantsCount: 0,
          deviceProfilesCount: 0,
          automationRulesCount: 0,
          automationEventsCount: 0,
          error: error instanceof Error ? error.message : "Unknown database error",
        },
      };
    }
  }
}
