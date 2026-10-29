import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class ConsumerReportDto {
  @ApiProperty({ type: String, maxLength: 2048 })
  @IsString()
  @MaxLength(2048)
  payload!: string;

  @ApiProperty({
    type: String,
    example: "I bought this elsewhere",
    maxLength: 1000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;
}
