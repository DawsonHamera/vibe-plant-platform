import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DevicesService } from "./devices.service";

@Injectable()
export class DevicesRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DevicesRuntimeService.name);
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly devicesService: DevicesService) {}

  onModuleInit(): void {
    const intervalMs = this.getPollIntervalMs();
    if (intervalMs <= 0) {
      this.logger.log("Live profile polling is disabled (VIBE_DEVICE_POLL_MS <= 0).");
      return;
    }

    this.timer = setInterval(() => {
      void this.pollLiveProfiles();
    }, intervalMs);

    void this.pollLiveProfiles();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async pollLiveProfiles(): Promise<void> {
    if (this.polling) {
      return;
    }

    this.polling = true;
    try {
      await this.devicesService.pollLiveProfilesFromAdapters();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown polling failure";
      this.logger.warn(`Live profile poll failed: ${message}`);
    } finally {
      this.polling = false;
    }
  }

  private getPollIntervalMs(): number {
    const raw = process.env.VIBE_DEVICE_POLL_MS?.trim();
    if (!raw) {
      return 2000;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return 2000;
    }

    return parsed;
  }
}
