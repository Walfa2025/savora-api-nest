import { Body, Controller, Post } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class PaymentsController {
  constructor(private readonly prisma: PrismaService) {}

  // MVP: simulate payment success
  @Post('/payments/mock/succeed')
  async succeed(@Body() body: { orderId: string; providerRef?: string }) {
    const orderId = (body?.orderId || '').trim();
    if (!orderId) return { ok: false, error: 'order_id_required' };

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { offer: true },
      });
      if (!order) return { ok: false as const, error: 'not_found' };

      if (order.status !== 'RESERVED') {
        return {
          ok: false as const,
          error: 'not_payable',
          status: order.status,
        };
      }

      const payment = await tx.payment.upsert({
        where: { orderId },
        update: {
          status: 'SUCCEEDED',
          providerRef: body?.providerRef || 'mock_' + Date.now(),
        },
        create: {
          orderId,
          status: 'SUCCEEDED',
          provider: 'MOCK',
          providerRef: body?.providerRef || 'mock_' + Date.now(),
          amountCents: order.offer.priceCents,
          currency: 'ALL',
        },
      });

      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: 'PAID' },
      });

      return { ok: true as const, order: updated, payment };
    });
  }
}
