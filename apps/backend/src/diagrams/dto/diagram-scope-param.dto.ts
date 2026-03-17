import { IsString, MaxLength } from "class-validator";

export class DiagramScopeParamDto {
  @IsString()
  @MaxLength(64)
  scope!: string;
}
