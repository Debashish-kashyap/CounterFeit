import {
  Controller,
  DefaultValuePipe,
  Get,
  Inject,
  ParseIntPipe,
  Query,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { LedgerService } from "./ledger.service";

@ApiTags("ledger")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.REGULATOR)
@Controller("ledger")
export class LedgerController {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  @Get("events")
  @ApiOkResponse({ description: "Most recent hash-chained ledger events" })
  async events(
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    if (limit < 1 || limit > 100) {
      throw new BadRequestException("limit must be between 1 and 100");
    }
    return this.ledger.recentEvents(limit);
  }

  @Get("verify")
  @ApiOkResponse({
    schema: {
      example: { valid: true, brokenAtId: null, checkedEvents: 24 },
    },
  })
  verify() {
    return this.ledger.verifyChain();
  }
}
