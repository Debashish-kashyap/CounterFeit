import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ type: String, example: "manufacturer@xuino.demo" })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ type: String, example: "DemoPass123!" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
