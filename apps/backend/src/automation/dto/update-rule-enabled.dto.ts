import { IsBoolean } from "class-validator";

export class UpdateRuleEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}
