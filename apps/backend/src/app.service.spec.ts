import { describe, expect, it } from "vitest";
import { AppService } from "./app.service";

describe("AppService health details", () => {
  it("returns ok health details with database counts", () => {
    const counts: Record<string, number> = {
      plants: 4,
      device_profiles: 2,
      automation_rules: 3,
      automation_events: 9,
    };

    const sqlite = {
      database: {
        prepare: (sql: string) => ({
          get: () => {
            const rawTable = sql.split("FROM ")[1]?.trim();
            const table = rawTable ?? "";
            return { count: counts[table] ?? 0 };
          },
        }),
      },
    };

    const service = new AppService(sqlite as never);
    const details = service.getHealthDetails();

    expect(details.status).toBe("ok");
    expect(details.database.ok).toBe(true);
    expect(details.database.plantsCount).toBe(4);
    expect(details.database.deviceProfilesCount).toBe(2);
    expect(details.database.automationRulesCount).toBe(3);
    expect(details.database.automationEventsCount).toBe(9);
  });

  it("returns degraded health details when database read fails", () => {
    const sqlite = {
      database: {
        prepare: () => {
          throw new Error("db unavailable");
        },
      },
    };

    const service = new AppService(sqlite as never);
    const details = service.getHealthDetails();

    expect(details.status).toBe("degraded");
    expect(details.database.ok).toBe(false);
    expect(details.database.error).toContain("db unavailable");
  });
});
