import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { Roles } from "./auth/roles.decorator";
import { UserRole } from "@prisma/client";

function toInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("/admin/audit")
  async list(
    @Query("limit") limitQ?: string,
    @Query("actorUserId") actorUserId?: string,
    @Query("action") action?: string,
    @Query("targetType") targetType?: string,
    @Query("targetId") targetId?: string
  ) {
    const limit = Math.min(Math.max(toInt(limitQ, 50), 1), 200);

    const where: any = {};
    if (actorUserId) where.actorUserId = String(actorUserId);
    if (action) where.action = String(action);
    if (targetType) where.targetType = String(targetType);
    if (targetId) where.targetId = String(targetId);

    const items = await this.prisma.adminAuditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        createdAt: true,
        actorUserId: true,
        actorRole: true,
        action: true,
        targetType: true,
        targetId: true,
        ip: true,
        userAgent: true,
        metaJson: true,
      },
    });

    return { items, meta: { count: items.length, limit } };
  }
}
