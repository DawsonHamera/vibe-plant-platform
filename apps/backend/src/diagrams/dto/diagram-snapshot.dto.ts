import { IsArray, IsObject } from "class-validator";

export class DiagramSnapshotDto {
  @IsArray()
  @IsObject({ each: true })
  nodes!: Array<Record<string, unknown>>;

  @IsArray()
  @IsObject({ each: true })
  edges!: Array<Record<string, unknown>>;
}
