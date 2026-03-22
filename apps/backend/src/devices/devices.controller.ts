import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CreateDeviceProfileDto } from "./dto/create-device-profile.dto";
import { IngestDeviceReadingDto } from "./dto/ingest-device-reading.dto";
import { UpdateDeviceProfileDto } from "./dto/update-device-profile.dto";
import {
  DeviceProfile,
  DeviceProfileReadingResult,
  DeviceProfileValidationResult,
  DevicesService,
} from "./devices.service";
import { AdapterChannelProbeResult } from "./adapters/device-adapter.interface";

@Controller("devices")
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get("discover")
  async discover() {
    return this.devicesService.discover();
  }

  @Get("profiles")
  profiles(): DeviceProfile[] {
    return this.devicesService.listProfiles();
  }

  @Get("test")
  async test(
    @Query("connectionType") connectionType: "serial" | "network" | "bluetooth",
    @Query("target") target: string,
  ): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    return this.devicesService.testConnection(connectionType, target);
  }

  @Get("probe-channels")
  async probeChannels(
    @Query("connectionType") connectionType: "serial" | "network" | "bluetooth",
    @Query("target") target: string,
  ): Promise<AdapterChannelProbeResult> {
    return this.devicesService.probeChannels(connectionType, target);
  }

  @Get("profiles/:id/live-channels")
  liveChannels(@Param("id") id: string): AdapterChannelProbeResult {
    return this.devicesService.getLiveChannelsForProfile(id);
  }

  @Post("profiles")
  create(@Body() payload: CreateDeviceProfileDto): DeviceProfile {
    return this.devicesService.createProfile(payload);
  }

  @Post("profiles/:id/simulate")
  async simulate(@Param("id") id: string): Promise<{ ok: boolean; message: string }> {
    return this.devicesService.simulateProfile(id);
  }

  @Post("profiles/:id/validate")
  validate(@Param("id") id: string): DeviceProfileValidationResult {
    return this.devicesService.validateProfile(id);
  }

  @Post("profiles/:id/ingest")
  ingestProfileReading(
    @Param("id") id: string,
    @Body() payload: IngestDeviceReadingDto,
  ): DeviceProfileReadingResult {
    return this.devicesService.ingestProfileReading(id, payload);
  }

  @Patch("profiles/:id/live")
  setLiveMode(
    @Param("id") id: string,
    @Body() payload: { isLive: boolean },
  ): DeviceProfile {
    return this.devicesService.setProfileLiveMode(id, payload.isLive);
  }

  @Patch("profiles/:id")
  update(
    @Param("id") id: string,
    @Body() payload: UpdateDeviceProfileDto,
  ): DeviceProfile {
    return this.devicesService.updateProfile(id, payload);
  }

  @Delete("profiles/:id")
  remove(@Param("id") id: string): { ok: boolean; deletedId: string } {
    return this.devicesService.deleteProfile(id);
  }

  @Delete("profiles")
  removeAll(): { ok: boolean; deletedCount: number } {
    return this.devicesService.deleteAllProfiles();
  }
}
