import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { PenaltyStatus } from "@prisma/client";

@Injectable()
export class SelfUnblockService {
  constructor(private readonly prisma: PrismaService) {}

  async initForUser(userId: string) {

    // Cooldown: allow self-unblock only once per 10 days (based on last CONFIRMED)
    const cooldownDays = 10;
    const lastConfirmed = await this.prisma.penaltyPayment.findFirst({
      where: { userId, status: PenaltyStatus.CONFIRMED },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (lastConfirmed?.createdAt) {
      const cooldownEndsAt = new Date(lastConfirmed.createdAt.getTime() + cooldownDays * 24 * 3600 * 1000);
      if (cooldownEndsAt > new Date()) {
        throw new ConflictException({ code: "COOLDOWN_ACTIVE", cooldownDays, cooldownEndsAt: cooldownEndsAt.toISOString() });
      }
    }

    const paymentId = "pp_" + Math.random().toString(36).slice(2, 10);
    const reference = "UB-" + Math.random().toString(36).toUpperCase().slice(2, 8);
    const expiresAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);

    const row = await this.prisma.penaltyPayment.create({
      data: {
        id: paymentId,
        userId,
        amountCents: 500,
        currency: "ALL",
        reference,
        expiresAt,
        status: PenaltyStatus.INITIATED,
      },
    });

    return {
      paymentId: row.id,
      amountMinor: row.amountCents,
      currency: row.currency,
      reference: row.reference,
      bankDetails: {
        beneficiaryName: "SAVORA SHPK",
        iban: "ALxx....",
        bankName: "..."
      },
      expiresAt: row.expiresAt.toISOString()
    };
  }

  async markProof(paymentId: string, userId: string) {
    const existing = await this.prisma.penaltyPayment.findUnique({ where: { id: paymentId } });
    if (!existing) throw new NotFoundException("PenaltyPayment not found");
    if (existing.userId !== userId) throw new NotFoundException("PenaltyPayment not found");

    const row = await this.prisma.penaltyPayment.update({
      where: { id: paymentId },
      data: { status: PenaltyStatus.PENDING_VERIFICATION },
    });

    return { paymentId: row.id, status: row.status };
  }

    async confirm(paymentId: string, bankTxnRef: string) {
      const now = new Date();
  
      return this.prisma.$transaction(async (tx) => {
        const existing = await tx.penaltyPayment.findUnique({ where: { id: paymentId } });
        if (!existing) throw new NotFoundException("PenaltyPayment not found");
  
        // Expiry guard (cannot confirm expired payments)
        if (existing.expiresAt && existing.expiresAt.getTime() < now.getTime()) {
          if (existing.status !== PenaltyStatus.EXPIRED) {
            await tx.penaltyPayment.update({
              where: { id: paymentId },
              data: { status: PenaltyStatus.EXPIRED },
            });
          }
          throw new ConflictException("CONFIRM_NOT_ALLOWED_EXPIRED");
        }
  
        // Idempotency / terminal-state guard
        if (existing.status === PenaltyStatus.CONFIRMED) {
          const u = await tx.user.findUnique({
            where: { id: existing.userId },
            select: { lastSelfUnblockAt: true },
          });
          return {
            paymentId: existing.id,
            status: existing.status,
            bankTxnRef: existing.bankTxnRef,
            lastSelfUnblockAt: u?.lastSelfUnblockAt ? u.lastSelfUnblockAt.toISOString() : null,
          };
        }
  
        if (existing.status === PenaltyStatus.REJECTED || existing.status === PenaltyStatus.EXPIRED) {
          throw new ConflictException("CONFIRM_NOT_ALLOWED");
        }
  
        // Require customer to submit proof before admin confirm
        if (existing.status === PenaltyStatus.INITIATED) {
          throw new ConflictException("CONFIRM_REQUIRES_PROOF");
        }
        if (existing.status !== PenaltyStatus.PENDING_VERIFICATION) {
          throw new ConflictException("CONFIRM_NOT_ALLOWED_STATE");
        }
  
        // Atomic state transition (protect against races)
        const upd = await tx.penaltyPayment.updateMany({
          where: { id: paymentId, status: PenaltyStatus.PENDING_VERIFICATION },
          data: { status: PenaltyStatus.CONFIRMED, bankTxnRef },
        });
  
        if (upd.count !== 1) {
          const again = await tx.penaltyPayment.findUnique({ where: { id: paymentId } });
          if (!again) throw new NotFoundException("PenaltyPayment not found");
  
          if (again.status === PenaltyStatus.CONFIRMED) {
            const u = await tx.user.findUnique({
              where: { id: again.userId },
              select: { lastSelfUnblockAt: true },
            });
            return {
              paymentId: again.id,
              status: again.status,
              bankTxnRef: again.bankTxnRef,
              lastSelfUnblockAt: u?.lastSelfUnblockAt ? u.lastSelfUnblockAt.toISOString() : null,
            };
          }
          if (again.status === PenaltyStatus.INITIATED) throw new ConflictException("CONFIRM_REQUIRES_PROOF");
          if (again.status === PenaltyStatus.EXPIRED) throw new ConflictException("CONFIRM_NOT_ALLOWED_EXPIRED");
          throw new ConflictException("CONFIRM_NOT_ALLOWED_STATE");
        }
  
        // Reduce NO_SHOW strikes to 2 active strikes (keep history, deactivate the rest)
        const strikes = await tx.strike.findMany({
          where: { userId: existing.userId, reason: "NO_SHOW" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
  
        const keepIds = strikes.slice(0, 2).map((x) => x.id);
  
        await tx.strike.updateMany({
          where: { userId: existing.userId, reason: "NO_SHOW" },
          data: { isActive: false },
        });
  
        if (keepIds.length) {
          await tx.strike.updateMany({
            where: { userId: existing.userId, reason: "NO_SHOW", id: { in: keepIds } },
            data: { isActive: true },
          });
        }
  
        await tx.user.update({
          where: { id: existing.userId },
          data: { lastSelfUnblockAt: now },
        });
  
        return { paymentId, status: PenaltyStatus.CONFIRMED, bankTxnRef, lastSelfUnblockAt: now.toISOString() };
      });
    }

}
