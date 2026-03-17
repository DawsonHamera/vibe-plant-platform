import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { PlantRecord } from "@vibe/shared";
import { mkdirSync, renameSync } from "node:fs";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { CreatePlantDto } from "./dto/create-plant.dto";
import { UpdatePlantDto } from "./dto/update-plant.dto";
import { PlantsService } from "./plants.service";
import { getRuntimeConfig } from "../config/runtime-config";

const uploadDir = getRuntimeConfig().uploadsDir;
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const ensureUploadDir = (): void => {
  mkdirSync(uploadDir, { recursive: true });
};

ensureUploadDir();

const imageFileFilter = (
  _request: unknown,
  file: { mimetype: string },
  callback: (error: Error | null, acceptFile: boolean) => void,
): void => {
  if (allowedImageMimeTypes.has(file.mimetype)) {
    callback(null, true);
    return;
  }

  callback(new UnsupportedMediaTypeException("Only image uploads are supported"), false);
};

type UploadedImageFile = {
  originalname: string;
  path: string;
  filename: string;
  mimetype: string;
  size: number;
};

@Controller("plants")
export class PlantsController {
  constructor(private readonly plantsService: PlantsService) {}

  @Get()
  list(): PlantRecord[] {
    return this.plantsService.list();
  }

  @Get(":id")
  getById(@Param("id") id: string): PlantRecord {
    return this.plantsService.getById(id);
  }

  @Post()
  create(@Body() payload: CreatePlantDto): PlantRecord {
    return this.plantsService.create(payload);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() payload: UpdatePlantDto): PlantRecord {
    return this.plantsService.update(id, payload);
  }

  @Delete(":id")
  remove(@Param("id") id: string): { deleted: true } {
    this.plantsService.remove(id);
    return { deleted: true };
  }

  @Post(":id/water")
  markWatered(@Param("id") id: string): PlantRecord {
    return this.plantsService.markWatered(id);
  }

  @Post(":id/image")
  @UseInterceptors(
    FileInterceptor("image", {
      dest: uploadDir,
      fileFilter: imageFileFilter,
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  uploadImage(@Param("id") id: string, @UploadedFile() image?: UploadedImageFile): PlantRecord {
    if (!image) {
      throw new BadRequestException("Image file is required");
    }

    ensureUploadDir();
    const extension = extensionByMimeType[image.mimetype] ?? extname(image.originalname).toLowerCase();
    if (!extension) {
      throw new UnsupportedMediaTypeException("Unsupported image format");
    }
    const normalizedFilename = `${randomUUID()}${extension}`;
    const normalizedPath = join(uploadDir, normalizedFilename);
    renameSync(image.path, normalizedPath);

    return this.plantsService.update(id, { imageUrl: `/uploads/${normalizedFilename}` });
  }
}

export { imageFileFilter };
