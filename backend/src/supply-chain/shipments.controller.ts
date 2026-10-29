import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth-user";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { validateRequestBody } from "../common/validate-request-body";
import { ShipCaseDto } from "./dto/ship-case.dto";
import { SupplyChainService } from "./supply-chain.service";

@ApiTags("shipments")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANUFACTURER)
@Controller("shipments")
export class ShipmentsController {
  constructor(
    @Inject(SupplyChainService)
    private readonly supplyChain: SupplyChainService,
  ) {}

  @Get("recipients")
  recipients(@Req() request: AuthenticatedRequest) {
    return this.supplyChain.listShipmentRecipients(request.user);
  }

  @Post()
  @ApiBody({ type: ShipCaseDto })
  @ApiCreatedResponse({ description: "Case shipment registered" })
  async ship(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const dto = await validateRequestBody(body, ShipCaseDto);
    return this.supplyChain.shipCase(dto, request.user);
  }
}
