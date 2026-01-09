import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual, randomInt } from 'crypto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private hashOtp(requestId: string, otp: string) {
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    return createHash('sha256')
      .update(`${requestId}:${otp}:${secret}`)
      .digest('hex');
  }

  async requestOtp(phoneE164: string) {
    const ttlSeconds = 120; // 2 min MVP
    const cooldownSeconds = 30; // simple throttle per phone

    const now = new Date();
    // infer "created within cooldown" using expiresAt (since expiresAt = createdAt + ttlSeconds)
    const threshold = new Date(
      now.getTime() + (ttlSeconds - cooldownSeconds) * 1000,
    );

    const recent = await this.prisma.otpRequest.findFirst({
      where: {
        phoneE164,
        usedAt: null,
        expiresAt: { gt: threshold },
      },
      orderBy: [{ expiresAt: 'desc' }],
      select: { id: true, expiresAt: true },
    });

    if (recent) {
      const remaining = Math.max(
        1,
        Math.ceil((recent.expiresAt.getTime() - now.getTime()) / 1000),
      );
      // re-use existing requestId; no new OTP generated
      return { requestId: recent.id, ttlSeconds: remaining, cooldown: true };
    }

    const requestId = 'req_' + Math.random().toString(36).slice(2, 10);
    const otp = String(randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = this.hashOtp(requestId, otp);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.otpRequest.create({
      data: { id: requestId, phoneE164, otpHash, expiresAt },
    });

    // HARD-DISABLE: never return otpDev
    return { requestId, ttlSeconds };
  }

  async verifyOtp(requestId: string, otp: string) {
    const r = await this.prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    if (!r) throw new UnauthorizedException('OTP_INVALID');
    if (r.usedAt) throw new UnauthorizedException('OTP_USED');
    if (r.expiresAt < new Date())
      throw new UnauthorizedException('OTP_EXPIRED');
    if (r.attempts >= 5)
      throw new UnauthorizedException('OTP_TOO_MANY_ATTEMPTS');

    const expected = Buffer.from(r.otpHash, 'hex');
    const got = Buffer.from(this.hashOtp(requestId, otp), 'hex');
    const ok = expected.length === got.length && timingSafeEqual(expected, got);

    await this.prisma.otpRequest.update({
      where: { id: requestId },
      data: {
        attempts: { increment: 1 },
        ...(ok ? { usedAt: new Date() } : {}),
      },
    });

    if (!ok) throw new UnauthorizedException('OTP_INVALID');

    const user =
      (await this.prisma.user.findUnique({
        where: { phoneE164: r.phoneE164 },
      })) ??
      (await this.prisma.user.create({
        data: { phoneE164: r.phoneE164, role: UserRole.CUSTOMER },
      }));

    const accessToken = this.jwt.sign({ sub: user.id });
    return { accessToken, expiresIn: 3600 };
  }
}
