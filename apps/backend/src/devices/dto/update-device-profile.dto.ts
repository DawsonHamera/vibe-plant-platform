import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, IsUUID } from "class-validator";

export class UpdateDeviceProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  connectionType?: "serial" | "network" | "bluetooth";

  @IsOptional()
  @IsString()
  transportTarget?: string;

  @IsOptional()
  @IsObject()
  channelMap?: Record<string, string>;

  @IsOptional()
  @IsObject()
  calibration?: Record<string, number>;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  channelAssignments?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  @Type(() => String)
  plantIds?: string[];

  @IsOptional()
  @IsBoolean()
  isLive?: boolean;
}
