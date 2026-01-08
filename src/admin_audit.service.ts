import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { UserRole } from "@prisma/client";

type AuditActor = { id: string; role: UserRole | string } | undefined;

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    actor: AuditActor;
    action: string;
    targetType: string;
    targetId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    meta?: any;
  }) {
    const actorId = String(params.actor?.id || "");
    if (!actorId) return;

    const actorRole = String(params.actor?.role || "ADMIN") as any;

    await this.prisma.adminAuditLog.create({
      data: {
        actorUserId: actorId,
        actorRole,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId || null,
        ip: params.ip || null,
        userAgent: params.userAgent || null,
        metaJson: params.meta ? JSON.stringify(params.meta) : null,
      },
    });
  }
}
