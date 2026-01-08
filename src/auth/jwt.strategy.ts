import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";

export type JwtUser = { id: string; role: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    const secret = config.get<string>("JWT_SECRET");
    if (!secret) throw new Error("JWT_SECRET missing (cannot validate jwt)");
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any): Promise<JwtUser> {
    const sub = payload?.sub;
    if (!sub) throw new UnauthorizedException("JWT missing sub");

    const user = await this.prisma.user.findUnique({
      where: { id: String(sub) },
      select: { id: true, role: true },
    });
    if (!user) throw new UnauthorizedException("User not found");

    return { id: user.id, role: user.role };
  }
}
