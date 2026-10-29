import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class RecordEventDto {
  @ApiProperty({ type: String, required: false, maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  @ApiProperty({ type: Number, required: false, minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiProperty({ type: Number, required: false, minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng?: number;
}
