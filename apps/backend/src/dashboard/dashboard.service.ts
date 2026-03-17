import { Injectable } from "@nestjs/common";
import type { DailyCareDecision, PlantRecord } from "@vibe/shared";
import { PlantsService } from "../plants/plants.service";

@Injectable()
export class DashboardService {
  constructor(private readonly plantsService: PlantsService) {}

  getDailyDecision(): DailyCareDecision {
    const today = new Date();
    const plants = this.plantsService.list();

    const duePlantIds: string[] = [];
    const overduePlantIds: string[] = [];

    plants.forEach((plant) => {
      const score = this.calculateWateringDeltaDays(plant, today);
      if (score >= plant.schedule.wateringEveryDays) {
        duePlantIds.push(plant.id);
      }
      if (score > plant.schedule.wateringEveryDays + 1) {
        overduePlantIds.push(plant.id);
      }
    });

    return {
      date: today.toISOString(),
      duePlantIds,
      overduePlantIds,
      alerts: overduePlantIds.length > 0 ? ["Overdue watering detected"] : [],
    };
  }

  private calculateWateringDeltaDays(plant: PlantRecord, now: Date): number {
    const anchor = plant.lastWateredAt ? new Date(plant.lastWateredAt) : new Date(plant.createdAt);
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.floor((now.getTime() - anchor.getTime()) / msPerDay);
  }
}
