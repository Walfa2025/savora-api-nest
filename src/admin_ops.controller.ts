import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { Roles } from "./auth/roles.decorator";
import { OfferStatus, UserRole, VendorStatus } from "@prisma/client";
import { AdminAuditService } from "./admin_audit.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminOpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService
  ) {}

  @Get("/admin/users")
  async users(@Query("role") role?: UserRole) {
    const where: any = {};
    if (role) where.role = role;

    const items = await this.prisma.user.findMany({
      where,
      select: { id: true, phoneE164: true, role: true, createdAt: true, updatedAt: true },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    });

    return { items, meta: { count: items.length } };
  }

  @Get("/admin/vendors")
  async vendors(@Query("status") status?: VendorStatus, @Query("ownerUserId") ownerUserId?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (ownerUserId) where.ownerUserId = String(ownerUserId);

    const items = await this.prisma.vendor.findMany({
      where,
      include: { owner: { select: { id: true, phoneE164: true, role: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    });

    return { items, meta: { count: items.length } };
  }

  @Get("/admin/offers")
  async offers(@Query("status") status?: OfferStatus, @Query("vendorId") vendorId?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (vendorId) where.vendorId = String(vendorId);

    const items = await this.prisma.offer.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true, status: true, ownerUserId: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    });

    return { items, meta: { count: items.length } };
  }

  @Post("/admin/offers/status")
  async setOfferStatus(@Req() req: any, @Body() body: { offerId: string; status: OfferStatus }) {
    const offerId = String(body?.offerId || "");
    const status = body?.status as OfferStatus;

    if (!offerId) throw new BadRequestException("offerId_required");
    if (!status) throw new BadRequestException("status_required");

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: { status },
      select: { id: true, status: true, vendorId: true },
    });

    await this.audit.log({
      actor: req.user,
      action: "OFFER_STATUS_SET",
      targetType: "Offer",
      targetId: updated.id,
      ip: req.ip,
      userAgent: req.headers?.["user-agent"],
      meta: { status: updated.status, vendorId: updated.vendorId },
    });

    return { ok: true, offer: updated };
  }
}
