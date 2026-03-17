import { Controller, Get } from "@nestjs/common";
import { AppService, HealthDetails } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("health")
  getHealth(): { status: string } {
    return this.appService.getHealth();
  }

  @Get("health/details")
  getHealthDetails(): HealthDetails {
    return this.appService.getHealthDetails();
  }
}
