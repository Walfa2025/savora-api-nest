import type { UserRole } from '@prisma/client';

export type JwtUser = { id: string; role: UserRole };

export type JwtPayload = {
  sub?: unknown;
  iat?: number;
  exp?: number;
  [k: string]: unknown;
};

declare module 'express-serve-static-core' {
  interface Request {
    user?: JwtUser;
  }
}
