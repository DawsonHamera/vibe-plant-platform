import { describe, expect, it, vi } from "vitest";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { DevicesController } from "./devices.controller";

describe("DevicesController", () => {
  it("delegates profile validation to service", () => {
    const validationResult = {
      ok: false,
      issues: [
        {
          severity: "error" as const,
          code: "CHANNEL_REQUIRED",
          message: "Channel mapping for moisture is required.",
        },
      ],
    };

    const devicesService = {
      discover: vi.fn(),
      listProfiles: vi.fn(),
      testConnection: vi.fn(),
      createProfile: vi.fn(),
      simulateProfile: vi.fn(),
      validateProfile: vi.fn(() => validationResult),
      setProfileLiveMode: vi.fn(),
      updateProfile: vi.fn(),
    };

    const controller = new DevicesController(devicesService as never);

    const result = controller.validate("profile-123");

    expect(devicesService.validateProfile).toHaveBeenCalledWith("profile-123");
    expect(devicesService.validateProfile).toHaveBeenCalledTimes(1);
    expect(result).toEqual(validationResult);
    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          severity: "error",
          code: "CHANNEL_REQUIRED",
          message: expect.any(String),
        },
      ],
    });
  });

  it("maps validate handler to POST /devices/profiles/:id/validate", () => {
    const handler = DevicesController.prototype.validate;

    expect(Reflect.getMetadata(PATH_METADATA, DevicesController)).toBe("devices");
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("profiles/:id/validate");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });

  it("delegates live mode toggles to service", () => {
    const devicesService = {
      discover: vi.fn(),
      listProfiles: vi.fn(),
      testConnection: vi.fn(),
      createProfile: vi.fn(),
      simulateProfile: vi.fn(),
      validateProfile: vi.fn(),
      setProfileLiveMode: vi.fn(() => ({
        id: "profile-123",
        name: "Desk Sensors",
        connectionType: "serial" as const,
        transportTarget: "COM3",
        channelMap: { moisture: "ch0", light: "ch1", temperature: "ch2" },
        calibration: { moistureDry: 900, moistureWet: 300 },
        isLive: true,
        createdAt: "2026-03-16T00:00:00.000Z",
        updatedAt: "2026-03-16T00:05:00.000Z",
      })),
      updateProfile: vi.fn(),
    };

    const controller = new DevicesController(devicesService as never);

    const result = controller.setLiveMode("profile-123", { isLive: true });
    expect(devicesService.setProfileLiveMode).toHaveBeenCalledWith("profile-123", true);
    expect(result.isLive).toBe(true);
  });
});
