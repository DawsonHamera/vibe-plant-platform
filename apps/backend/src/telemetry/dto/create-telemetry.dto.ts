import { Type } from "class-transformer";
import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class CreateTelemetryDto {
  @IsUUID()
  plantId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  moisture?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  light?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-40)
  @Max(60)
  temperature?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  humidity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  reservoirLevel?: number;

  @IsOptional()
  @IsISO8601()
  capturedAt?: string;
}
