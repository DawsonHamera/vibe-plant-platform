import { IsBoolean, IsObject, IsString } from "class-validator";

export class CreateRuleDto {
  @IsString()
  name!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsObject()
  condition!: Record<string, unknown>;

  @IsObject()
  action!: Record<string, unknown>;

  @IsObject()
  safety!: Record<string, unknown>;
}
