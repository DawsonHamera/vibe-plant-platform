import { OmitType, PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min, ValidateNested } from "class-validator";
import { CreatePlantDto } from "./create-plant.dto";

class UpdatePlantScheduleDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(30)
	wateringEveryDays?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(90)
	fertilizingEveryDays?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(120)
	pruningEveryDays?: number;
}

export class UpdatePlantDto extends PartialType(OmitType(CreatePlantDto, ["schedule"] as const)) {
	@IsOptional()
	@ValidateNested()
	@Type(() => UpdatePlantScheduleDto)
	schedule?: UpdatePlantScheduleDto;
}
