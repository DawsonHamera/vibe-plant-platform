import { Controller, Get } from "@nestjs/common";
import type { DailyCareDecision } from "@vibe/shared";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("daily")
  daily(): DailyCareDecision {
    return this.dashboardService.getDailyDecision();
  }
}
