import { IsBoolean, IsObject, IsOptional, IsString } from "class-validator";

export class UpdateDeviceProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  channelMap?: Record<string, string>;

  @IsOptional()
  @IsObject()
  calibration?: Record<string, number>;

  @IsOptional()
  @IsBoolean()
  isLive?: boolean;
}
