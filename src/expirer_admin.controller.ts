import { Controller, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { Roles } from "./auth/roles.decorator";
import { UserRole } from "@prisma/client";
import { OrdersExpirer } from "./orders.expirer";
import { AdminAuditService } from "./admin_audit.service";

@Controller()
export class ExpirerAdminController {
  constructor(
    private readonly expirer: OrdersExpirer,
    private readonly audit: AdminAuditService
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post("/admin/expirer/tick")
  async tick(@Req() req: any) {
    await this.expirer.tickNow();
    await this.audit.log({
      actor: req.user,
      action: "EXPIRER_TICK",
      targetType: "OrdersExpirer",
      targetId: null,
      ip: req.ip,
      userAgent: req.headers?.["user-agent"],
    });
    return { ok: true };
  }
}
