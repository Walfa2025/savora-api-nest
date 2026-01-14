import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual, randomInt } from 'crypto';
import { UserRole } from '@prisma/client';
import nodemailer from 'nodemailer';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+\d{8,15}$/;
const DEFAULT_SMTP_HOST = 'email-smtp.eu-west-1.amazonaws.com';
const DEFAULT_SMTP_PORT = 587;

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

  private getSmtpConfig() {
    const host = process.env.SES_SMTP_HOST || DEFAULT_SMTP_HOST;
    const port = Number(process.env.SES_SMTP_PORT || DEFAULT_SMTP_PORT);
    const user = process.env.SES_SMTP_USER;
    const pass = process.env.SES_SMTP_PASS;
    const from = process.env.MAIL_FROM;

    if (!user || !pass || !from) {
      throw new InternalServerErrorException('SMTP_NOT_CONFIGURED');
    }

    return { host, port, user, pass, from };
  }

  private async sendOtpEmail(email: string, otp: string) {
    const config = this.getSmtpConfig();
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });

    await transporter.sendMail({
      from: config.from,
      to: email,
      subject: 'Savora login code',
      text: `Je Savora code is: ${otp}\n\nDeze code verloopt binnen 2 minuten.`,
    });
  }

  async requestOtp({
    phoneE164,
    email,
  }: {
    phoneE164?: string;
    email?: string;
  }) {
    const trimmedPhone = String(phoneE164 || '').trim();
    const trimmedEmail = String(email || '').trim().toLowerCase();

    if (!trimmedPhone && !trimmedEmail) {
      throw new BadRequestException('phone_or_email_required');
    }
    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
      throw new BadRequestException('email_invalid');
    }
    if (trimmedPhone && !PHONE_REGEX.test(trimmedPhone)) {
      throw new BadRequestException('phoneE164_invalid_e164');
    }

    const identifier = trimmedEmail
      ? { email: trimmedEmail }
      : { phoneE164: trimmedPhone };

    const ttlSeconds = 120; // 2 min MVP
    const cooldownSeconds = 30; // simple throttle per phone

    const now = new Date();
    // infer "created within cooldown" using expiresAt (since expiresAt = createdAt + ttlSeconds)
    const threshold = new Date(
      now.getTime() + (ttlSeconds - cooldownSeconds) * 1000,
    );

    const recent = await this.prisma.otpRequest.findFirst({
      where: {
        ...identifier,
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
      return {
        requestId: recent.id,
        ttlSeconds: remaining,
        cooldown: true,
        delivery: trimmedEmail ? 'email' : 'sms',
      };
    }

    const requestId = 'req_' + Math.random().toString(36).slice(2, 10);
    const otp = String(randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = this.hashOtp(requestId, otp);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.otpRequest.create({
      data: {
        id: requestId,
        otpHash,
        expiresAt,
        phoneE164: trimmedPhone || undefined,
        email: trimmedEmail || undefined,
      },
    });

    if (trimmedEmail) {
      try {
        await this.sendOtpEmail(trimmedEmail, otp);
      } catch (error: any) {
        const message = String(error?.message || error);
        if (/Invalid login|535|EAUTH/i.test(message)) {
          throw new InternalServerErrorException('SMTP_AUTH_FAILED');
        }
        throw new InternalServerErrorException('EMAIL_SEND_FAILED');
      }
    }

    // HARD-DISABLE: never return otpDev
    return { requestId, ttlSeconds, delivery: trimmedEmail ? 'email' : 'sms' };
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

    const lookup = r.email
      ? { email: r.email }
      : r.phoneE164
        ? { phoneE164: r.phoneE164 }
        : null;
    if (!lookup) {
      throw new UnauthorizedException('OTP_INVALID');
    }

    const user =
      (await this.prisma.user.findUnique({ where: lookup })) ??
      (await this.prisma.user.create({
        data: {
          role: UserRole.CUSTOMER,
          email: r.email || null,
          phoneE164: r.phoneE164 || null,
        },
      }));

    const accessToken = this.jwt.sign({ sub: user.id });
    return { accessToken, expiresIn: 3600 };
  }
}
