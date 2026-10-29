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
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { validateRequestBody } from "../common/validate-request-body";
import { ConsumerReportDto } from "./dto/consumer-report.dto";
import { SupplyChainService } from "./supply-chain.service";

interface PublicRequest {
  ip?: string;
}

@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(
    @Inject(SupplyChainService)
    private readonly supplyChain: SupplyChainService,
  ) {}

  @Post()
  @ApiBody({ type: ConsumerReportDto })
  @ApiCreatedResponse({ description: "Consumer report recorded" })
  async report(
    @Body() body: unknown,
    @Req() request: PublicRequest,
  ) {
    const dto = await validateRequestBody(body, ConsumerReportDto);
    return this.supplyChain.createConsumerReport(dto, { ip: request.ip });
  }

  @Get("reconciliation")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.REGULATOR)
  @ApiOkResponse({ description: "Pack receipts and sales reconciled per pharmacy" })
  reconcile() {
    return this.supplyChain.reconcileStock();
  }
}
