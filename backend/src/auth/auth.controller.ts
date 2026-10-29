import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AuthenticatedRequest } from "./auth-user";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { validateRequestBody } from "../common/validate-request-body";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ description: "JWT and safe user profile" })
  @ApiBadRequestResponse({ description: "Missing or invalid login request body" })
  @ApiUnauthorizedResponse({ description: "Invalid email or password" })
  async login(@Body() body: unknown) {
    const dto = await validateRequestBody(body, LoginDto);
    return this.authService.login(dto.email, dto.password);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: "Current user's safe profile" })
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.getUser(request.user.id);
  }
}
