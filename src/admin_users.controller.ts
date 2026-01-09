import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from './prisma/prisma.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { Roles } from './auth/roles.decorator';
import { Prisma, UserRole } from '@prisma/client';
import { AdminAuditService } from './admin_audit.service';

@Controller()
export class AdminUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('/admin/users/role')
  async setRole(
    @Req() req: Request,
    @Body() body: { userId?: string; phoneE164?: string; role: UserRole },
  ) {
    const role = body?.role;
    if (!role) throw new BadRequestException('role_required');

    const where: Prisma.UserWhereUniqueInput = {};
    if (body?.userId) where.id = String(body.userId);
    else if (body?.phoneE164) where.phoneE164 = String(body.phoneE164);
    else throw new BadRequestException('userId_or_phoneE164_required');

    const updated = await this.prisma.user.update({
      where,
      data: { role },
      select: { id: true, phoneE164: true, role: true },
    });

    await this.audit.log({
      actor: req.user,
      action: 'USER_ROLE_SET',
      targetType: 'User',
      targetId: updated.id,
      ip: req.ip || null,
      userAgent: req.get('user-agent') || null,
      meta: { phoneE164: updated.phoneE164, role: updated.role },
    });

    return { ok: true, user: updated };
  }
}
