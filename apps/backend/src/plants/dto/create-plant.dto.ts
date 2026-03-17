import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsISO8601,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import type { PlantHealthState, PlantSchedule } from "@vibe/shared";

const growthStages = ["seedling", "vegetative", "mature"] as const;

class PlantScheduleDto implements PlantSchedule {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  wateringEveryDays!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  fertilizingEveryDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  pruningEveryDays?: number;
}

export class CreatePlantDto {
  @IsString()
  nickname!: string;

  @IsString()
  species!: string;

  @IsString()
  zone!: string;

  @IsEnum(growthStages)
  growthStage!: (typeof growthStages)[number];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsEnum(["excellent", "good", "watch", "critical"])
  healthState!: PlantHealthState;

  @ValidateNested()
  @Type(() => PlantScheduleDto)
  schedule!: PlantScheduleDto;

  @IsOptional()
  @IsISO8601()
  lastWateredAt?: string;
}
