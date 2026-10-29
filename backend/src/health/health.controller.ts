import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Check API and database availability" })
  @ApiOkResponse({
    schema: {
      example: { status: "ok", database: "connected" },
    },
  })
  async check(): Promise<{ status: "ok"; database: "connected" }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "connected" };
  }
}
