import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';

function toNumber(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// MVP: SQLite, so we do bounding-box filter by lat/lng and time window.
// Later: PostGIS + ST_DWithin for true radius search.
@ApiTags('Offers')
@Controller()
export class OffersController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiQuery({ name: 'lat', required: true, schema: { type: 'number', example: 41.3275 } })
  @ApiQuery({ name: 'lng', required: true, schema: { type: 'number', example: 19.8187 } })
  @ApiQuery({ name: 'radius_km', required: true, schema: { type: 'number', example: 5 } })
  @ApiQuery({
    name: 'from',
    required: true,
    schema: { type: 'string', format: 'date-time', example: '2026-01-10T08:00:00Z' },
  })
  @ApiQuery({
    name: 'to',
    required: true,
    schema: { type: 'string', format: 'date-time', example: '2026-01-10T20:00:00Z' },
  })
  @ApiOkResponse({
    description: 'List offers (geo bounding-box + time window)',
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object' } },
        meta: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
            radiusKm: { type: 'number' },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            count: { type: 'integer' },
          },
        },
      },
    },
  })
  @Get('/offers')
  async listOffers(
    @Query('lat') latQ?: string,
    @Query('lng') lngQ?: string,
    @Query('radius_km') radiusQ?: string,
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
  ) {
    const lat = toNumber(latQ, 41.3275); // Tirana default
    const lng = toNumber(lngQ, 19.8187);
    const radiusKm = Math.min(Math.max(toNumber(radiusQ, 5), 0.2), 50);

    // rough bounding box (works well enough for MVP)
    const latDelta = radiusKm / 111; // km per degree latitude
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);

    const now = new Date();
    const from = fromQ ? new Date(fromQ) : new Date(now.getTime() - 60 * 60 * 1000);
    const to = toQ ? new Date(toQ) : new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const offers = await this.prisma.offer.findMany({
      where: {
        status: 'LIVE',
        qtyAvailable: { gt: 0 },
        pickupStart: { lte: to },
        pickupEnd: { gte: from },
        vendor: {
          status: 'APPROVED',
          lat: { gte: lat - latDelta, lte: lat + latDelta },
          lng: { gte: lng - lngDelta, lte: lng + lngDelta },
        },
      },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            addressText: true,
            lat: true,
            lng: true,
          },
        },
      },
      orderBy: [{ pickupStart: 'asc' }],
      take: 100,
    });

    return {
      items: offers,
      meta: { lat, lng, radiusKm, from, to, count: offers.length },
    };
  }
}
