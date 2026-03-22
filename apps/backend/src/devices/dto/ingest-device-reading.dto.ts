import { IsISO8601, IsObject, IsOptional } from "class-validator";

export class IngestDeviceReadingDto {
  @IsObject()
  channels!: Record<string, number>;

  @IsOptional()
  @IsISO8601()
  capturedAt?: string;
}
