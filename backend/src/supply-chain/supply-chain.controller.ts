import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import {
  ApiBody,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { validateRequestBody } from "../common/validate-request-body";
import { CheckPackDto } from "./dto/check-pack.dto";
import { SupplyChainService } from "./supply-chain.service";

interface PublicRequest {
  ip?: string;
}

@ApiTags("verification")
@Controller("verify")
export class SupplyChainController {
  constructor(
    @Inject(SupplyChainService)
    private readonly supplyChain: SupplyChainService,
  ) {}

  @Post("check")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: CheckPackDto })
  @ApiOkResponse({
    description: "Public pack check; records the check without changing pack state",
  })
  async check(
    @Body() body: unknown,
    @Req() request: PublicRequest,
  ) {
    const dto = await validateRequestBody(body, CheckPackDto);
    return this.supplyChain.checkPack(dto, { ip: request.ip });
  }
}
