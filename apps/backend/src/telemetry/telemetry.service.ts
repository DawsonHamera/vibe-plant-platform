import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { TelemetryPoint } from "@vibe/shared";
import { PlantsService } from "../plants/plants.service";
import { TelemetryStateService } from "./telemetry-state.service";
import { TelemetryTransportService } from "./telemetry-transport.service";

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly plantsService: PlantsService,
    private readonly telemetryTransport: TelemetryTransportService,
    private readonly telemetryState: TelemetryStateService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      const plants = this.plantsService.list();
      plants.forEach((plant) => {
        const point: TelemetryPoint = {
          plantId: plant.id,
          moisture: this.randomInRange(25, 75),
          light: this.randomInRange(120, 450),
          temperature: this.randomInRange(18, 29),
          capturedAt: new Date().toISOString(),
        };

        this.telemetryState.record(point);
        this.telemetryTransport.publishTelemetry(point);
      });
    }, 5000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private randomInRange(min: number, max: number): number {
    return Math.round((Math.random() * (max - min) + min) * 10) / 10;
  }
}
