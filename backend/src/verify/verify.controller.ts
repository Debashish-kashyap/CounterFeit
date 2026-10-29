import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth-user";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { VerifyQrDto } from "./dto/verify-qr.dto";
import { VerifyService } from "./verify.service";
import { validateRequestBody } from "../common/validate-request-body";

@ApiTags("verification")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PHARMACY)
@Controller("verify")
export class VerifyController {
  constructor(
    @Inject(VerifyService) private readonly verifyService: VerifyService,
  ) {}

  @Post("pack")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: VerifyQrDto })
  @ApiOkResponse({ description: "Single-pack verification result" })
  async verifyPack(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const dto = await validateRequestBody(body, VerifyQrDto);
    return this.verifyService.verifyPack(dto, request.user);
  }

  @Post("case")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: VerifyQrDto })
  @ApiOkResponse({ description: "Case receipt and pack count" })
  async verifyCase(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const dto = await validateRequestBody(body, VerifyQrDto);
    return this.verifyService.verifyCase(dto, request.user);
  }
}
