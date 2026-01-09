import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { Roles } from './auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { OrdersExpirer } from './orders.expirer';
import { AdminAuditService } from './admin_audit.service';

@Controller()
export class ExpirerAdminController {
  constructor(
    private readonly expirer: OrdersExpirer,
    private readonly audit: AdminAuditService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('/admin/expirer/tick')
  async tick(@Req() req: Request) {
    await this.expirer.tickNow();
    await this.audit.log({
      actor: req.user,
      action: 'EXPIRER_TICK',
      targetType: 'OrdersExpirer',
      targetId: null,
      ip: req.ip || null,
      userAgent: req.get('user-agent') || null,
    });
    return { ok: true };
  }
}
