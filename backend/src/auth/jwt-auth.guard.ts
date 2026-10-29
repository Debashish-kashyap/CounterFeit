import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import { getAppSecret } from "../config/secrets";
import { AuthUser } from "./auth-user";

interface JwtClaims {
  sub: string;
  email: string;
  role: UserRole;
}

interface AuthenticatedHttpRequest {
  headers: { authorization?: string };
  user: AuthUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("A bearer token is required");
    }

    try {
      let secret: string;
      try {
        secret = getAppSecret("JWT_SECRET");
      } catch {
        throw new UnauthorizedException("JWT_SECRET is not configured securely");
      }
      const claims = await this.jwtService.verifyAsync<JwtClaims>(token, {
        secret,
      });
      if (
        typeof claims.sub !== "string" ||
        typeof claims.email !== "string" ||
        !Object.values(UserRole).includes(claims.role)
      ) {
        throw new UnauthorizedException("Invalid access token");
      }

      request.user = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
      };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }
}
