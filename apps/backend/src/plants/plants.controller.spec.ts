import { ArgumentMetadata, BadRequestException, UnsupportedMediaTypeException, ValidationPipe } from "@nestjs/common";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UpdatePlantDto } from "./dto/update-plant.dto";
import { imageFileFilter, PlantsController } from "./plants.controller";

const validationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const updateBodyMetadata: ArgumentMetadata = {
  type: "body",
  metatype: UpdatePlantDto,
  data: "",
};

const validateUpdatePayload = async (payload: unknown): Promise<UpdatePlantDto> => {
  return validationPipe.transform(payload, updateBodyMetadata) as Promise<UpdatePlantDto>;
};

describe("PlantsController image upload", () => {
  it("persists uploaded image path through plants service update", () => {
    const tmpDir = fs.mkdtempSync(join(tmpdir(), "plant-upload-"));
    const sourcePath = join(tmpDir, "tmp-upload");
    fs.writeFileSync(sourcePath, "test-image-content", "utf8");

    const plantsService = {
      list: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn((id: string, payload: { imageUrl: string }) => ({ id, ...payload })),
      remove: vi.fn(),
      markWatered: vi.fn(),
    };

    const controller = new PlantsController(plantsService as never);

    const result = controller.uploadImage("plant-1", {
      filename: "tmp-upload",
      mimetype: "image/png",
      originalname: "image-1.png",
      path: sourcePath,
      size: 32,
    });

    expect(plantsService.update).toHaveBeenCalledTimes(1);
    const firstUpdateCall = plantsService.update.mock.calls.at(0);
    if (!firstUpdateCall) {
      throw new Error("Expected plantsService.update to be called once");
    }

    const payload = firstUpdateCall[1] as { imageUrl: string };
    expect(payload.imageUrl).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);
    expect(result).toEqual({ id: "plant-1", imageUrl: payload.imageUrl });

    const movedPath = join(process.cwd(), "data", "uploads", payload.imageUrl.split("/").pop() ?? "");
    fs.rmSync(movedPath, { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws BadRequestException when file is missing", () => {
    const plantsService = {
      list: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      markWatered: vi.fn(),
    };

    const controller = new PlantsController(plantsService as never);

    expect(() => controller.uploadImage("plant-1", undefined)).toThrow(BadRequestException);
  });

  it("accepts common image mime types", () => {
    const callback = vi.fn();

    imageFileFilter({}, { mimetype: "image/webp" }, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it("rejects non-image mime types", () => {
    const callback = vi.fn();

    imageFileFilter({}, { mimetype: "application/pdf" }, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    const [error, accepted] = callback.mock.calls[0] as [unknown, unknown];
    expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
    expect(accepted).toBe(false);
  });

  it("forwards PATCH payload updates to plants service", () => {
    const plantsService = {
      list: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn((id: string, payload: UpdatePlantDto) => ({ id, ...payload })),
      remove: vi.fn(),
      markWatered: vi.fn(),
    };

    const controller = new PlantsController(plantsService as never);
    const payload: UpdatePlantDto = {
      nickname: "Desk Ivy",
      species: "Epipremnum aureum",
      zone: "Office",
      notes: "Rotate weekly",
      imageUrl: "https://example.com/plant.png",
      healthState: "watch",
      schedule: {
        wateringEveryDays: 4,
        fertilizingEveryDays: 20,
        pruningEveryDays: 60,
      },
    };

    const result = controller.update("plant-1", payload);

    expect(plantsService.update).toHaveBeenCalledWith("plant-1", payload);
    expect(result).toEqual({ id: "plant-1", ...payload });
  });
});

describe("UpdatePlantDto validation", () => {
  it("accepts partial schedule updates", async () => {
    await expect(
      validateUpdatePayload({
        schedule: {
          fertilizingEveryDays: "14",
        },
      }),
    ).resolves.toMatchObject({
      schedule: {
        fertilizingEveryDays: 14,
      },
    });
  });

  it("rejects wateringEveryDays below minimum", async () => {
    await expect(
      validateUpdatePayload({
        schedule: {
          wateringEveryDays: 0,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects fertilizingEveryDays above maximum", async () => {
    await expect(
      validateUpdatePayload({
        schedule: {
          fertilizingEveryDays: 91,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
