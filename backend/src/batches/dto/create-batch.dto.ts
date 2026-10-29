import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateBatchDto {
  @ApiProperty({ example: "Paracetamol 500 mg" })
  @IsString()
  @MaxLength(160)
  drugName!: string;

  @ApiProperty({ example: "XUINO-2026-001" })
  @IsString()
  @MaxLength(80)
  batchNumber!: string;

  @ApiProperty({ example: "2026-01-15", format: "date" })
  @IsDateString()
  mfgDate!: string;

  @ApiProperty({ example: "2028-01-15", format: "date" })
  @IsDateString()
  expiryDate!: string;

  @ApiProperty({ minimum: 1, maximum: 50, example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  numCases!: number;

  @ApiProperty({ minimum: 1, maximum: 100, example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  packsPerCase!: number;
}
