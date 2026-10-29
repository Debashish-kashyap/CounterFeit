import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, MaxLength } from "class-validator";

export class ShipCaseDto {
  @ApiProperty({ type: String, example: "CASE-abc123" })
  @IsString()
  @MaxLength(128)
  caseCode!: string;

  @ApiProperty({
    type: String,
    description: "Pharmacy user ID receiving the shipment",
  })
  @IsUUID()
  toOrgId!: string;
}
