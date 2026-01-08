import { BadRequestException, Body, Controller, NotFoundException, Post, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { Roles } from "./auth/roles.decorator";
import { UserRole } from "@prisma/client";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class DevAuthController {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  @Post("/admin/dev/impersonate")
  async impersonate(@Req() req: any, @Body() body: { phoneE164: string }) {
    if ((process.env.NODE_ENV || "") !== "development") {
      throw new NotFoundException();
    }

    const phoneE164 = String(body?.phoneE164 || "").trim();
    if (!/^\+\d{8,15}$/.test(phoneE164)) {
      throw new BadRequestException("phoneE164_invalid_e164");
    }

    const user =
      (await this.prisma.user.findUnique({ where: { phoneE164 } })) ??
      (await this.prisma.user.create({ data: { phoneE164, role: UserRole.CUSTOMER } }));

    const accessToken = this.jwt.sign({ sub: user.id }, { expiresIn: "1h" });
    return { accessToken, expiresIn: 3600, user: { id: user.id, role: user.role, phoneE164: user.phoneE164 } };
  }
}
