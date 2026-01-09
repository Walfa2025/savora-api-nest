import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload, JwtUser } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET missing (cannot validate jwt)');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtUser> {
    const subRaw = payload?.sub;
    const sub = typeof subRaw === 'string' ? subRaw : undefined;
    if (!sub) throw new UnauthorizedException('JWT missing sub');

    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, role: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    return { id: user.id, role: user.role };
  }
}

// Backward-compatible re-export if anything imports JwtUser from this file
export type { JwtUser } from './auth.types';
