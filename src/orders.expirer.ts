import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class OrdersExpirer implements OnModuleInit {
  private readonly log = new Logger(OrdersExpirer.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if ((process.env.NODE_ENV || '') === 'test') return;
    const intervalMs =
      parseInt(process.env.EXPIRER_INTERVAL_MS || '30000', 10) || 30000;

    setInterval(() => {
      void this.tickNow().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.error(msg);
      });
    }, intervalMs);
    void this.tickNow().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(msg);
    });
  }

  async tickNow() {
    const now = new Date();

    // 1) RESERVED -> EXPIRED when reservedUntil passed (qty back)
    const expired = await this.prisma.order.findMany({
      where: { status: 'RESERVED', reservedUntil: { lt: now } },
      select: { id: true, offerId: true },
      take: 200,
    });

    // 2) PAID -> NO_SHOW when pickupEnd + grace passed (no qty change)
    const graceMin =
      parseInt(process.env.NO_SHOW_GRACE_MINUTES || '30', 10) || 30;
    const cutoff = new Date(now.getTime() - graceMin * 60 * 1000);

    const noShows = await this.prisma.order.findMany({
      where: {
        status: 'PAID',
        offer: { pickupEnd: { lt: cutoff } },
      },
      select: { id: true, customerUserId: true },
      take: 200,
    });

    if (!expired.length && !noShows.length) return;

    await this.prisma.$transaction(async (tx) => {
      for (const o of expired) {
        const r = await tx.order.updateMany({
          where: { id: o.id, status: 'RESERVED', reservedUntil: { lt: now } },
          data: { status: 'EXPIRED' },
        });
        if (r.count === 1) {
          await tx.offer.update({
            where: { id: o.offerId },
            data: { qtyAvailable: { increment: 1 } },
          });
        }
      }

      for (const o of noShows) {
        const r = await tx.order.updateMany({
          where: { id: o.id, status: 'PAID' },
          data: { status: 'NO_SHOW' },
        });
        if (r.count === 1) {
          await tx.strike.create({
            data: {
              userId: o.customerUserId,
              reason: 'NO_SHOW',
              isActive: true,
            },
          });
        }
      }
    });

    this.log.log(
      `expired_orders=${expired.length} no_show_orders=${noShows.length} graceMin=${graceMin}`,
    );
  }
}
