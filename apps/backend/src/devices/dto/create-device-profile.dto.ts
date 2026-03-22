import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

export class CreateDeviceProfileDto {
  @IsString()
  name!: string;

  @IsIn(["serial", "network", "bluetooth"])
  connectionType!: "serial" | "network" | "bluetooth";

  @IsString()
  transportTarget!: string;

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

  @IsBoolean()
  isLive!: boolean;
}
