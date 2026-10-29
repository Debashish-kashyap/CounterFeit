import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth-user";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { BatchesService } from "./batches.service";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { validateRequestBody } from "../common/validate-request-body";

@ApiTags("batches")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANUFACTURER)
@Controller("batches")
export class BatchesController {
  constructor(
    @Inject(BatchesService) private readonly batchesService: BatchesService,
  ) {}

  @Post()
  @ApiCreatedResponse({ description: "Batch and signed QR records created" })
  async create(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const dto = await validateRequestBody(body, CreateBatchDto);
    return this.batchesService.create(dto, request.user);
  }

  @Get()
  @ApiOkResponse({ description: "Batches belonging to the current manufacturer" })
  list(@Req() request: AuthenticatedRequest) {
    return this.batchesService.list(request.user);
  }

  @Get(":id/qr")
  @ApiOkResponse({ description: "Signed case and pack QR payloads" })
  getQrSheet(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batchesService.getQrSheet(id, request.user);
  }
}
