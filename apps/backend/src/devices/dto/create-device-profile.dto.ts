import { IsBoolean, IsIn, IsObject, IsString } from "class-validator";

export class CreateDeviceProfileDto {
  @IsString()
  name!: string;

  @IsIn(["serial", "network", "bluetooth"])
  connectionType!: "serial" | "network" | "bluetooth";

  @IsString()
  transportTarget!: string;

  @IsObject()
  channelMap!: Record<string, string>;

  @IsObject()
  calibration!: Record<string, number>;

  @IsBoolean()
  isLive!: boolean;
}
