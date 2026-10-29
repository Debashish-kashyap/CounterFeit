import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth-user";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { validateRequestBody } from "../common/validate-request-body";
import { RecordEventDto } from "./dto/record-event.dto";
import { SupplyChainService } from "./supply-chain.service";

@ApiTags("cases")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PHARMACY)
@Controller("cases")
export class CasesController {
  constructor(
    @Inject(SupplyChainService)
    private readonly supplyChain: SupplyChainService,
  ) {}

  @Post(":code/receive")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: RecordEventDto })
  @ApiOkResponse({ description: "Record pharmacy receipt of a shipped case" })
  async receive(
    @Param("code") code: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const dto = await validateRequestBody(body, RecordEventDto);
    return this.supplyChain.receiveCase(code, dto, request.user, {
      ip: request.ip,
    });
  }
}
