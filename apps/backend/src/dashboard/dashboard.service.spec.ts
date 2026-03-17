import { describe, expect, it } from "vitest";
import type { PlantRecord } from "@vibe/shared";
import { DashboardService } from "./dashboard.service";

const daysAgo = (days: number): string => {
  const now = new Date();
  now.setDate(now.getDate() - days);
  return now.toISOString();
};

const plant = (id: string, wateredDaysAgo: number, interval: number): PlantRecord => ({
  id,
  nickname: id,
  species: "Pothos",
  zone: "Living Room",
  growthStage: "mature",
  healthState: "good",
  schedule: { wateringEveryDays: interval },
  lastWateredAt: daysAgo(wateredDaysAgo),
  createdAt: daysAgo(15),
  updatedAt: daysAgo(1),
});

describe("DashboardService", () => {
  it("flags due and overdue plants", () => {
    const plantsService = {
      list: () => [plant("due", 4, 3), plant("overdue", 6, 3), plant("ok", 1, 3)],
    };

    const service = new DashboardService(plantsService as never);
    const daily = service.getDailyDecision();

    expect(daily.duePlantIds).toContain("due");
    expect(daily.overduePlantIds).toContain("overdue");
    expect(daily.alerts.length).toBe(1);
  });
});
