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

export class VerifyQrDto {
  @ApiProperty({
    type: String,
    description: "Complete QR value: base64url payload followed by its HMAC signature",
    example: "eyJ0IjoiUCIsInMiOiIwMDEyMzQ1Njc4OWFiY2RlZiIsInYiOjF9.<signature>",
    maxLength: 2048,
  })
  @IsString()
  @MaxLength(2048)
  payload!: string;

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
