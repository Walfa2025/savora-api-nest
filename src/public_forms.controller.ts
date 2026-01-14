import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { PublicFormsService } from './public_forms.service';

type WaitlistPayload = {
  name?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  website?: string;
};

type PartnerPayload = {
  store?: string;
  city?: string;
  street?: string;
  address?: string;
  postcode?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  website?: string;
};

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requireFields(
  payload: Record<string, unknown>,
  fields: string[],
): Record<string, string> {
  const missing = fields.filter((field) => !normalizeText(payload[field]));
  if (missing.length) {
    throw new HttpException(
      `Missing required fields: ${missing.join(', ')}`,
      HttpStatus.BAD_REQUEST,
    );
  }
  const result: Record<string, string> = {};
  fields.forEach((field) => {
    result[field] = normalizeText(payload[field]);
  });
  return result;
}

@Controller()
export class PublicFormsController {
  constructor(private readonly publicForms: PublicFormsService) {}

  @Post('public/waitlist')
  async waitlist(@Body() body: WaitlistPayload) {
    if (normalizeText(body.website)) {
      return { ok: true, skipped: true };
    }

    const required = requireFields(body as Record<string, unknown>, [
      'name',
      'email',
    ]);
    if (!isValidEmail(required.email)) {
      throw new HttpException('Invalid email', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.publicForms.submitWaitlist({
        name: required.name,
        email: required.email,
        phone: normalizeText(body.phone) || undefined,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
      });
      return { ok: true };
    } catch (error: any) {
      const message = String(error?.message || error);
      if (message.startsWith('SMTP_NOT_CONFIGURED:')) {
        throw new HttpException('SMTP not configured', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      if (message === 'SMTP_AUTH_FAILED') {
        throw new HttpException('SMTP auth failed', HttpStatus.BAD_GATEWAY);
      }
      throw new HttpException('Unable to send', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('public/partner')
  async partner(@Body() body: PartnerPayload) {
    if (normalizeText(body.website)) {
      return { ok: true, skipped: true };
    }

    const required = requireFields(body as Record<string, unknown>, [
      'store',
      'city',
      'street',
      'address',
      'postcode',
      'email',
    ]);
    if (!isValidEmail(required.email)) {
      throw new HttpException('Invalid email', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.publicForms.submitPartner({
        store: required.store,
        city: required.city,
        street: required.street,
        address: required.address,
        postcode: required.postcode,
        email: required.email,
        phone: normalizeText(body.phone) || undefined,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
      });
      return { ok: true };
    } catch (error: any) {
      const message = String(error?.message || error);
      if (message.startsWith('SMTP_NOT_CONFIGURED:')) {
        throw new HttpException('SMTP not configured', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      if (message === 'SMTP_AUTH_FAILED') {
        throw new HttpException('SMTP auth failed', HttpStatus.BAD_GATEWAY);
      }
      throw new HttpException('Unable to send', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
