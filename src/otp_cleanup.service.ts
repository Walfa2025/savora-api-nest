import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";

@Injectable()
export class OtpCleanupService implements OnModuleInit {
  private readonly log = new Logger(OtpCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if ((process.env.NODE_ENV||"") === "test") return;
    const intervalMs = 5 * 60 * 1000; // every 5 minutes
    setInterval(() => this.tickNow().catch((e) => this.log.error(e?.message || e)), intervalMs);
    this.tickNow().catch((e) => this.log.error(e?.message || e));
  }

  async tickNow() {
    const now = new Date();
    const del = await this.prisma.otpRequest.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }],
      },
    });
    if (del.count) this.log.log(`otp_cleanup_deleted=${del.count}`);
    return { deleted: del.count };
  }

  async stats() {
    const now = new Date();
    const total = await this.prisma.otpRequest.count();
    const expired = await this.prisma.otpRequest.count({ where: { expiresAt: { lt: now } } });
    const used = await this.prisma.otpRequest.count({ where: { usedAt: { not: null } } });
    return { total, expired, used };
  }
}
