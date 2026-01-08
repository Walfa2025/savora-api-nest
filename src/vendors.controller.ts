import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { Roles } from "./auth/roles.decorator";
import { OfferStatus, UserRole, VendorStatus } from "@prisma/client";

@Controller()
export class VendorsController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(JwtAuthGuard)
  @Get("/vendor/me")
  async me(@Req() req: any) {
    const userId = req.user?.id;
    const vendors = await this.prisma.vendor.findMany({
      where: { ownerUserId: String(userId) },
      orderBy: [{ createdAt: "desc" }],
    });
    return { items: vendors };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR, UserRole.ADMIN)
  @Patch("/vendor/me/:vendorId")
  async updateMyVendor(
    @Req() req: any,
    @Param("vendorId") vendorId: string,
    @Body()
    body: {
      name?: string;
      addressText?: string;
      lat?: number;
      lng?: number;
      openingHoursJson?: string | null;
    }
  ) {
    const v = await this.prisma.vendor.findUnique({
      where: { id: String(vendorId) },
      select: { id: true, ownerUserId: true },
    });
    if (!v) throw new BadRequestException("vendor_not_found");

    const isAdmin = req.user?.role === UserRole.ADMIN;
    if (!isAdmin && String(req.user?.id) !== String(v.ownerUserId))
      throw new BadRequestException("not_vendor_owner");

    const data: any = {};
    if (body?.name !== undefined) data.name = String(body.name).trim();
    if (body?.addressText !== undefined)
      data.addressText = String(body.addressText).trim();
    if (body?.lat !== undefined) {
      const lat = Number(body.lat);
      if (!Number.isFinite(lat)) throw new BadRequestException("lat_invalid");
      data.lat = lat;
    }
    if (body?.lng !== undefined) {
      const lng = Number(body.lng);
      if (!Number.isFinite(lng)) throw new BadRequestException("lng_invalid");
      data.lng = lng;
    }
    if (body?.openingHoursJson !== undefined)
      data.openingHoursJson = body.openingHoursJson;

    if (Object.keys(data).length === 0)
      throw new BadRequestException("no_fields");

    const updated = await this.prisma.vendor.update({
      where: { id: String(vendorId) },
      data,
      select: {
        id: true,
        status: true,
        name: true,
        addressText: true,
        lat: true,
        lng: true,
        openingHoursJson: true,
      },
    });

    return { ok: true, vendor: updated };
  }

  // Anyone logged-in can apply; admin can later approve.
  @UseGuards(JwtAuthGuard)
  @Post("/vendor/apply")
  async apply(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      addressText: string;
      lat: number;
      lng: number;
      openingHoursJson?: string;
    }
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException("no_user");

    const name = (body?.name || "").trim();
    const addressText = (body?.addressText || "").trim();
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);

    if (!name) throw new BadRequestException("name_required");
    if (!addressText) throw new BadRequestException("address_required");
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      throw new BadRequestException("lat_lng_required");

    const v = await this.prisma.vendor.create({
      data: {
        ownerUserId: String(userId),
        status: VendorStatus.PENDING,
        name,
        addressText,
        lat,
        lng,
        openingHoursJson: body?.openingHoursJson,
      },
      select: {
        id: true,
        status: true,
        name: true,
        addressText: true,
        lat: true,
        lng: true,
        ownerUserId: true,
      },
    });

    return { ok: true, vendor: v };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR, UserRole.ADMIN)
  @Get("/vendor/offers")
  async listMyOffers(@Req() req: any) {
    const isAdmin = req.user?.role === UserRole.ADMIN;
    const userId = String(req.user?.id);

    const offers = await this.prisma.offer.findMany({
      where: isAdmin ? undefined : { vendor: { ownerUserId: userId } },
      include: {
        vendor: { select: { id: true, name: true, status: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });

    return { items: offers, meta: { count: offers.length } };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR, UserRole.ADMIN)
  @Post("/vendor/offers")
  async createOffer(
    @Req() req: any,
    @Body()
    body: {
      vendorId: string;
      title: string;
      description?: string;
      priceCents: number;
      currency?: string;
      qtyTotal: number;
      pickupStart: string;
      pickupEnd: string;
      allergensJson?: string;
      tagsJson?: string;
    }
  ) {
    const vendorId = String(body?.vendorId || "");
    if (!vendorId) throw new BadRequestException("vendorId_required");

    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, ownerUserId: true, status: true },
    });
    if (!vendor) throw new BadRequestException("vendor_not_found");

    const isAdmin = req.user?.role === UserRole.ADMIN;
    if (!isAdmin && String(req.user?.id) !== String(vendor.ownerUserId))
      throw new BadRequestException("not_vendor_owner");

    const title = (body?.title || "").trim();
    const priceCents = Number(body?.priceCents);
    const qtyTotal = Number(body?.qtyTotal);
    const pickupStart = new Date(body?.pickupStart);
    const pickupEnd = new Date(body?.pickupEnd);

    if (!title) throw new BadRequestException("title_required");
    if (!Number.isFinite(priceCents) || priceCents <= 0)
      throw new BadRequestException("priceCents_invalid");
    if (!Number.isFinite(qtyTotal) || qtyTotal <= 0)
      throw new BadRequestException("qtyTotal_invalid");
    if (
      Number.isNaN(pickupStart.getTime()) ||
      Number.isNaN(pickupEnd.getTime())
    )
      throw new BadRequestException("pickupStart_pickupEnd_invalid");
    if (pickupEnd <= pickupStart)
      throw new BadRequestException("pickupEnd_must_be_after_pickupStart");

    const offer = await this.prisma.offer.create({
      data: {
        vendorId,
        status: OfferStatus.DRAFT,
        title,
        description: body?.description,
        priceCents: Math.trunc(priceCents),
        currency: body?.currency || "ALL",
        qtyTotal: Math.trunc(qtyTotal),
        qtyAvailable: Math.trunc(qtyTotal),
        pickupStart,
        pickupEnd,
        allergensJson: body?.allergensJson,
        tagsJson: body?.tagsJson,
      },
      select: {
        id: true,
        status: true,
        vendorId: true,
        title: true,
        priceCents: true,
        currency: true,
        qtyTotal: true,
        qtyAvailable: true,
        pickupStart: true,
        pickupEnd: true,
      },
    });

    return { ok: true, offer };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR, UserRole.ADMIN)
  @Patch("/vendor/offers/:id")
  async updateOffer(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      description?: string | null;
      priceCents?: number;
      currency?: string;
      qtyTotal?: number;
      pickupStart?: string;
      pickupEnd?: string;
      allergensJson?: string | null;
      tagsJson?: string | null;
    }
  ) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: String(id) },
      select: {
        id: true,
        vendorId: true,
        status: true,
        qtyTotal: true,
        qtyAvailable: true,
        pickupStart: true,
        pickupEnd: true,
      },
    });
    if (!offer) throw new BadRequestException("offer_not_found");

    const vendor = await this.prisma.vendor.findUnique({
      where: { id: offer.vendorId },
      select: { id: true, ownerUserId: true },
    });
    if (!vendor) throw new BadRequestException("vendor_not_found");

    const isAdmin = req.user?.role === UserRole.ADMIN;
    if (!isAdmin && String(req.user?.id) !== String(vendor.ownerUserId))
      throw new BadRequestException("not_vendor_owner");

    // Do not allow edits after pickup window ended.
    if (offer.pickupEnd && new Date(offer.pickupEnd) <= new Date())
      throw new BadRequestException("pickup_window_expired");

    // Allow edits only for DRAFT/PAUSED/LIVE (MVP rule)
    if (
      offer.status !== OfferStatus.DRAFT &&
      offer.status !== OfferStatus.PAUSED &&
      offer.status !== OfferStatus.LIVE
    ) {
      throw new BadRequestException("offer_not_editable_status");
    }

    const data: any = {};

    if (body?.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) throw new BadRequestException("title_required");
      data.title = t;
    }
    if (body?.description !== undefined) data.description = body.description;

    if (body?.priceCents !== undefined) {
      const pc = Number(body.priceCents);
      if (!Number.isFinite(pc) || pc <= 0) throw new BadRequestException("priceCents_invalid");
      data.priceCents = Math.trunc(pc);
    }
    if (body?.currency !== undefined) data.currency = String(body.currency || "ALL");

    // qtyTotal change: keep qtyAvailable consistent.
    if (body?.qtyTotal !== undefined) {
      const qt = Number(body.qtyTotal);
      if (!Number.isFinite(qt) || qt <= 0) throw new BadRequestException("qtyTotal_invalid");

      const oldTotal = offer.qtyTotal ?? 0;
      const oldAvail = offer.qtyAvailable ?? 0;
      const reservedCount = Math.max(oldTotal - oldAvail, 0);

      if (qt < reservedCount) throw new BadRequestException("qtyTotal_below_reserved");

      data.qtyTotal = Math.trunc(qt);
      data.qtyAvailable = Math.trunc(qt - reservedCount);
    }

    let newStart: Date | undefined;
    let newEnd: Date | undefined;

    if (body?.pickupStart !== undefined) {
      newStart = new Date(body.pickupStart);
      if (Number.isNaN(newStart.getTime()))
        throw new BadRequestException("pickupStart_invalid");
      data.pickupStart = newStart;
    }
    if (body?.pickupEnd !== undefined) {
      newEnd = new Date(body.pickupEnd);
      if (Number.isNaN(newEnd.getTime()))
        throw new BadRequestException("pickupEnd_invalid");
      data.pickupEnd = newEnd;
    }

    const start = newStart ?? new Date(offer.pickupStart);
    const end = newEnd ?? new Date(offer.pickupEnd);
    if (end <= start) throw new BadRequestException("pickupEnd_must_be_after_pickupStart");

    if (body?.allergensJson !== undefined) data.allergensJson = body.allergensJson;
    if (body?.tagsJson !== undefined) data.tagsJson = body.tagsJson;

    if (Object.keys(data).length === 0)
      throw new BadRequestException("no_fields");

    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data,
      select: {
        id: true,
        status: true,
        title: true,
        description: true,
        priceCents: true,
        currency: true,
        qtyTotal: true,
        qtyAvailable: true,
        pickupStart: true,
        pickupEnd: true,
      },
    });

    return { ok: true, offer: updated };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR, UserRole.ADMIN)
  @Post("/vendor/offers/:id/publish")
  async publish(@Req() req: any, @Param("id") id: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: String(id) },
      select: { id: true, vendorId: true, qtyAvailable: true, pickupEnd: true },
    });
    if (!offer) throw new BadRequestException("offer_not_found");

    const vendor = await this.prisma.vendor.findUnique({
      where: { id: offer.vendorId },
      select: { id: true, ownerUserId: true, status: true },
    });
    if (!vendor) throw new BadRequestException("vendor_not_found");

    const isAdmin = req.user?.role === UserRole.ADMIN;
    if (!isAdmin && String(req.user?.id) !== String(vendor.ownerUserId))
      throw new BadRequestException("not_vendor_owner");
    if (vendor.status !== VendorStatus.APPROVED)
      throw new BadRequestException("vendor_not_approved");
    if ((offer.qtyAvailable ?? 0) <= 0)
      throw new BadRequestException("qtyAvailable_must_be_gt_0");
    if (offer.pickupEnd && new Date(offer.pickupEnd) <= new Date())
      throw new BadRequestException("pickup_window_expired");

    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: { status: OfferStatus.LIVE },
      select: { id: true, status: true },
    });

    return { ok: true, offer: updated };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR, UserRole.ADMIN)
  @Post("/vendor/offers/:id/pause")
  async pause(@Req() req: any, @Param("id") id: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: String(id) },
      select: { id: true, vendorId: true, status: true },
    });
    if (!offer) throw new BadRequestException("offer_not_found");

    const vendor = await this.prisma.vendor.findUnique({
      where: { id: offer.vendorId },
      select: { id: true, ownerUserId: true },
    });
    if (!vendor) throw new BadRequestException("vendor_not_found");

    const isAdmin = req.user?.role === UserRole.ADMIN;
    if (!isAdmin && String(req.user?.id) !== String(vendor.ownerUserId))
      throw new BadRequestException("not_vendor_owner");
    if (offer.status !== OfferStatus.LIVE)
      throw new BadRequestException("offer_not_live");

    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: { status: OfferStatus.PAUSED },
      select: { id: true, status: true },
    });

    return { ok: true, offer: updated };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR, UserRole.ADMIN)
  @Post("/vendor/offers/:id/resume")
  async resume(@Req() req: any, @Param("id") id: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: String(id) },
      select: {
        id: true,
        vendorId: true,
        status: true,
        qtyAvailable: true,
        pickupEnd: true,
      },
    });
    if (!offer) throw new BadRequestException("offer_not_found");

    const vendor = await this.prisma.vendor.findUnique({
      where: { id: offer.vendorId },
      select: { id: true, ownerUserId: true, status: true },
    });
    if (!vendor) throw new BadRequestException("vendor_not_found");

    const isAdmin = req.user?.role === UserRole.ADMIN;
    if (!isAdmin && String(req.user?.id) !== String(vendor.ownerUserId))
      throw new BadRequestException("not_vendor_owner");
    if (vendor.status !== VendorStatus.APPROVED)
      throw new BadRequestException("vendor_not_approved");
    if (offer.status !== OfferStatus.PAUSED)
      throw new BadRequestException("offer_not_paused");
    if ((offer.qtyAvailable ?? 0) <= 0)
      throw new BadRequestException("qtyAvailable_must_be_gt_0");
    if (offer.pickupEnd && new Date(offer.pickupEnd) <= new Date())
      throw new BadRequestException("pickup_window_expired");

    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: { status: OfferStatus.LIVE },
      select: { id: true, status: true },
    });

    return { ok: true, offer: updated };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post("/admin/vendors/status")
  async setVendorStatus(@Body() body: { vendorId: string; status: VendorStatus }) {
    const vendorId = String(body?.vendorId || "");
    const status = body?.status as VendorStatus;

    if (!vendorId) throw new BadRequestException("vendorId_required");
    if (!status) throw new BadRequestException("status_required");

    const updated = await this.prisma.vendor.update({
      where: { id: vendorId },
      data: { status },
      select: { id: true, ownerUserId: true, status: true, name: true },
    });

    return { ok: true, vendor: updated };
  }
}
