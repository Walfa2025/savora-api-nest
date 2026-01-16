import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from './prisma/prisma.service';

const DEFAULT_SMTP_HOST = 'email-smtp.eu-west-1.amazonaws.com';
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_PARTNER_CSV_PATH = 'data/partner_requests.csv';

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  toDefault: string;
  toWaitlist?: string;
  toPartner?: string;
};

type WaitlistPayload = {
  name: string;
  email: string;
  phone?: string;
  tags?: string[];
};

type PartnerPayload = {
  store: string;
  city: string;
  street: string;
  address: string;
  postcode: string;
  email: string;
  phone?: string;
  tags?: string[];
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`SMTP_NOT_CONFIGURED:${name}`);
  }
  return value;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function safeSmtpError(err: any) {
  return {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    command: err?.command,
    responseCode: err?.responseCode,
    response: err?.response,
    errno: err?.errno,
    syscall: err?.syscall,
    address: err?.address,
    port: err?.port,
  };
}


@Injectable()
export class PublicFormsService {
  constructor(private readonly prisma: PrismaService) {}

  private getSmtpConfig(): SmtpConfig {
    const host = process.env.SES_SMTP_HOST || DEFAULT_SMTP_HOST;
    const port = Number(process.env.SES_SMTP_PORT || DEFAULT_SMTP_PORT);
    const user = requireEnv('SES_SMTP_USER');
    const pass = requireEnv('SES_SMTP_PASS');
    const from = requireEnv('MAIL_FROM');
    const toDefault = requireEnv('MAIL_TO');
    const toWaitlist = process.env.MAIL_TO_WAITLIST;
    const toPartner = process.env.MAIL_TO_PARTNER;

    if (user.startsWith('AKIA')) {
      console.warn(
        'SES_SMTP_USER looks like an AWS access key; make sure you use SMTP credentials.',
      );
    }

    return { host, port, user, pass, from, toDefault, toWaitlist, toPartner };
  }

  private createTransport(config: SmtpConfig) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });
  }

  private pickRecipient(
    config: SmtpConfig,
    type: 'waitlist' | 'partner',
  ): string {
    if (type === 'partner') {
      return config.toPartner || config.toDefault;
    }
    return config.toWaitlist || config.toDefault;
  }

  private getPartnerCsvPath(): string {
    const rawPath = process.env.PARTNER_REQUESTS_CSV_PATH || DEFAULT_PARTNER_CSV_PATH;
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  }

  private ensurePartnerCsvHeader(filePath: string) {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const header =
        'id,store,city,street,address,postcode,email,phone,tags,createdAt\n';
      fs.writeFileSync(filePath, header);
    }
  }

  private appendPartnerCsv(record: {
    id: string;
    store: string;
    city: string;
    street: string;
    address: string;
    postcode: string;
    email: string;
    phone: string | null;
    tagsJson: string | null;
    createdAt: Date;
  }) {
    const filePath = this.getPartnerCsvPath();
    this.ensurePartnerCsvHeader(filePath);
    const row = [
      record.id,
      record.store,
      record.city,
      record.street,
      record.address,
      record.postcode,
      record.email,
      record.phone || '',
      record.tagsJson || '',
      record.createdAt.toISOString(),
    ]
      .map((value) => csvEscape(String(value)))
      .join(',');
    fs.appendFileSync(filePath, `${row}\n`);
  }

  async submitWaitlist(payload: WaitlistPayload) {
    console.log("SMTP_ENV", {
      host: !!process.env.SES_SMTP_HOST,
      port: !!process.env.SES_SMTP_PORT,
      user: !!process.env.SES_SMTP_USER,
      pass: !!process.env.SES_SMTP_PASS,
      from: !!process.env.MAIL_FROM,
    });
    const config = this.getSmtpConfig();
    const transporter = this.createTransport(config);
    const to = this.pickRecipient(config, 'waitlist');
    const text = [
      'New waitlist signup',
      `Name: ${normalizeText(payload.name)}`,
      `Email: ${normalizeText(payload.email)}`,
      `Phone: ${normalizeText(payload.phone) || '-'}`,
      `Tags: ${(payload.tags || []).join(', ') || '-'}`,
    ].join('\n');

    try {
      await transporter.sendMail({
        from: config.from,
        to,
        replyTo: payload.email,
        subject: 'Savora waitlist signup',
        text,
      });
    } catch (error: any) {
      console.error('SMTP_SEND_FAIL', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        response: error?.response,
        responseCode: error?.responseCode,
        command: error?.command,
      });

      const message = String(error?.message || error);
      if (/Invalid login|535|EAUTH/i.test(message)) {
        throw new Error('SMTP_AUTH_FAILED');
      }
      throw error;
    }
  }

  async submitPartner(payload: PartnerPayload) {
    const config = this.getSmtpConfig();
    const transporter = this.createTransport(config);
    const to = this.pickRecipient(config, 'partner');
    const tagsJson =
      payload.tags && payload.tags.length ? JSON.stringify(payload.tags) : null;
    const text = [
      'New partner request',
      `Store: ${normalizeText(payload.store)}`,
      `City: ${normalizeText(payload.city)}`,
      `Street: ${normalizeText(payload.street)}`,
      `Address: ${normalizeText(payload.address)}`,
      `Postcode: ${normalizeText(payload.postcode)}`,
      `Email: ${normalizeText(payload.email)}`,
      `Phone: ${normalizeText(payload.phone) || '-'}`,
      `Tags: ${(payload.tags || []).join(', ') || '-'}`,
    ].join('\n');

    const record = await this.prisma.partnerRequest.create({
      data: {
        store: normalizeText(payload.store),
        city: normalizeText(payload.city),
        street: normalizeText(payload.street),
        address: normalizeText(payload.address),
        postcode: normalizeText(payload.postcode),
        email: normalizeText(payload.email),
        phone: normalizeText(payload.phone) || null,
        tagsJson,
      },
    });

    try {
      this.appendPartnerCsv(record);
    } catch (error) {
      console.warn('partner_csv_append_failed', error);
    }

    try {
      await transporter.sendMail({
        from: config.from,
        to,
        replyTo: payload.email,
        subject: 'Savora partner request',
        text,
      });
    } catch (error: any) {
      console.error('SMTP_SEND_FAIL', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        response: error?.response,
        responseCode: error?.responseCode,
        command: error?.command,
      });

      const message = String(error?.message || error);
      if (/Invalid login|535|EAUTH/i.test(message)) {
        throw new Error('SMTP_AUTH_FAILED');
      }
      throw error;
    }
  }
}
