import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';

export type AuditContext = Express.AuditContext;

const isProd = (process.env.NODE_ENV || 'development') === 'production';
if (!process.env.JWT_SECRET) {
  if (isProd) {
    throw new Error('FATAL: JWT_SECRET environment variable is not defined.');
  }
  process.env.JWT_SECRET = 'dev-jwt-secret-change-me';
  logger.warn('JWT_SECRET not set; using insecure dev default');
}
const JWT_SECRET = process.env.JWT_SECRET!;

const userCache = new Map<string, { user: Express.UserTokenPayload; expiresAt: number }>();
const CACHE_TTL = 60 * 1000;

type TokenPayload = { id: string; tokenVersion?: number };

function queryTokenFromRequest(req: Request): string | null {
  const raw = req.query && typeof req.query === 'object' ? Reflect.get(req.query, 'token') : undefined;
  if (typeof raw === 'string') return raw.trim() || null;
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') return raw[0].trim() || null;
  return null;
}

function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.split(' ')[1]?.trim();
  if (headerToken) return headerToken;
  if (req.method === 'GET') return queryTokenFromRequest(req);
  return null;
}

function parseTokenPayload(token: string): TokenPayload | null {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (!decoded || typeof decoded !== 'object') return null;
  const idRaw = Reflect.get(decoded, 'id');
  const id = typeof idRaw === 'string' ? idRaw : '';
  if (!id) return null;
  const tokenVersionRaw = Reflect.get(decoded, 'tokenVersion');
  const tokenVersion =
    typeof tokenVersionRaw === 'number' && Number.isFinite(tokenVersionRaw)
      ? tokenVersionRaw
      : undefined;
  return { id, tokenVersion };
}

export async function quoteOptionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractAuthToken(req);
    if (!token) return next();

    try {
      const decoded = parseTokenPayload(token);
      if (!decoded) return next();
      const cached = userCache.get(decoded.id);

      if (cached && Date.now() < cached.expiresAt) {
        if (decoded.tokenVersion !== undefined && cached.user.tokenVersion !== decoded.tokenVersion) return next();
        if (!cached.user.isActive) return next();
        req.user = cached.user;
        return next();
      }

      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (user && user.isActive) {
        if (decoded.tokenVersion === undefined || user.tokenVersion === decoded.tokenVersion) {
          userCache.set(decoded.id, { user, expiresAt: Date.now() + CACHE_TTL });
          req.user = user;
        }
      }
    } catch {
      // Invalid token on optional path -> guest.
    }
    return next();
  } catch {
    return next();
  }
}

export async function quoteAuditLog(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const correlationId = (req.headers['x-correlation-id'] as string) || req.correlationId;
    const actionId = req.headers['x-action-id'] as string;
    const tenantId = String(req.headers['x-tenant-id'] || '').trim() || undefined;
    const actorId = req.user?.id || 'system';
    const actorType = req.user?.role || 'SYSTEM';
    req.auditContext = { correlationId, actionId, tenantId, actorId, actorType };
    next();
  } catch {
    next();
  }
}
