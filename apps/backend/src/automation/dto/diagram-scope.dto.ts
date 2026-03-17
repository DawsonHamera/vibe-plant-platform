import { IsString, MaxLength } from "class-validator";

export class DiagramScopeDto {
  @IsString()
  @MaxLength(64)
  scope!: string;
}
