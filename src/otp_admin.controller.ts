import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { Roles } from "./auth/roles.decorator";
import { UserRole } from "@prisma/client";
import { OtpCleanupService } from "./otp_cleanup.service";

@Controller()
export class OtpAdminController {
  constructor(private readonly otpCleanup: OtpCleanupService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get("/admin/otp/stats")
  async stats() {
    return { ok: true, ...(await this.otpCleanup.stats()) };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post("/admin/otp/cleanup")
  async cleanup() {
    return { ok: true, ...(await this.otpCleanup.tickNow()) };
  }
}
