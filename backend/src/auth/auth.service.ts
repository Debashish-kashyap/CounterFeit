import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compare } from "bcryptjs";
import { getAppSecret } from "../config/secrets";
import { PrismaService } from "../prisma/prisma.service";

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  locationName: true,
  lat: true,
  lng: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ access_token: string; user: Awaited<ReturnType<AuthService["getUser"]>> }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { ...userSelect, passwordHash: true },
    });

    if (!user || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    let secret: string;
    try {
      secret = getAppSecret("JWT_SECRET");
    } catch {
      throw new ServiceUnavailableException(
        "Set JWT_SECRET to a private value of at least 32 characters",
      );
    }

    const access_token = await this.jwtService.signAsync(
      { email: user.email, role: user.role },
      { subject: user.id, secret, expiresIn: "8h" },
    );
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return { access_token, user: safeUser };
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });
    if (!user) {
      throw new UnauthorizedException("The authenticated user no longer exists");
    }
    return user;
  }
}
