import {
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
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
import { DashboardService } from "./dashboard.service";

@ApiTags("dashboard")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.REGULATOR)
@Controller("dashboard")
export class DashboardController {
  constructor(
    @Inject(DashboardService)
    private readonly dashboard: DashboardService,
  ) {}

  @Get("summary")
  @ApiOkResponse({
    schema: {
      example: {
        totalScans: 120,
        genuine: 90,
        suspicious: 10,
        expired: 8,
        unknown: 12,
      },
    },
  })
  summary() {
    return this.dashboard.summary();
  }

  @Get("scans")
  @ApiOkResponse({ description: "Paginated scan log with optional filters" })
  scans(@Query() query: Record<string, string | undefined>) {
    return this.dashboard.scans(query);
  }

  @Get("flagged")
  @ApiOkResponse({ description: "Paginated suspicious scans and reasons" })
  flagged(@Query() query: Record<string, string | undefined>) {
    return this.dashboard.flagged(query);
  }

  @Get("hotspots")
  @ApiOkResponse({ description: "Suspicious scans grouped by coordinates" })
  hotspots() {
    return this.dashboard.hotspots();
  }
}
