import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class TimelineQueryDto {
  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsString()
  plantId?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}