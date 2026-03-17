import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CreateDeviceProfileDto } from "./dto/create-device-profile.dto";
import { UpdateDeviceProfileDto } from "./dto/update-device-profile.dto";
import {
  DeviceProfile,
  DeviceProfileValidationResult,
  DevicesService,
} from "./devices.service";

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
}
