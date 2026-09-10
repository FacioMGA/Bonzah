
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';
import { readActivePlatformSession } from '../../../modules/platformIdentity/domain/sessions.js';

// Dev ergonomics: allow running locally without a configured JWT secret.
// Production safety: require JWT_SECRET.
const platformMode = process.env.KERNEL_PLATFORM_MODE === 'true';
const isProd = (process.env.NODE_ENV || 'development') === 'production' || platformMode;
if (!process.env.JWT_SECRET) {
  if (isProd) {
    throw new Error('FATAL: JWT_SECRET environment variable is not defined.');
  }
  process.env.JWT_SECRET = 'dev-jwt-secret-change-me';
  logger.warn('JWT_SECRET not set; using insecure dev default');
}
const JWT_SECRET = process.env.JWT_SECRET!;

// Simple in-memory cache for user lookups (1 minute TTL)
const userCache = new Map<string, { user: Express.UserTokenPayload, expiresAt: number }>();
const CACHE_TTL = 60 * 1000;

type TokenPayload = { id: string; tokenVersion?: number; tenant_slug?: string; sessionKind?: string; sessionId?: string };

function requestUser(user: Express.UserTokenPayload, claims: TokenPayload): Express.UserTokenPayload {
  return { id: user.id, role: user.role, tokenVersion: user.tokenVersion, isActive: user.isActive,
    email: user['email'], name: user['name'], userType: user['userType'],
    primaryAccountId: user['primaryAccountId'], mfaEnabled: user['mfaEnabled'],
    emailVerifiedAt: user['emailVerifiedAt'], tenant_slug: claims.tenant_slug, sessionKind: claims.sessionKind, sessionId: claims.sessionId }; 
}

function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.split(' ')[1]?.trim();
  if (headerToken) return headerToken;
  // Security hardening: query-string tokens are forbidden.
  if (req.query && typeof req.query === 'object' && Reflect.has(req.query, 'token')) {
    logger.warn({ path: req.path }, 'Rejected query-string token authentication attempt');
  }
  return null;
}

function parseTokenPayload(token: string): TokenPayload | null {
  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  if (!decoded || typeof decoded !== 'object') return null;
  const idRaw = Reflect.get(decoded, 'id');
  const id = typeof idRaw === 'string' ? idRaw : '';
  if (!id) return null;
  const tokenVersionRaw = Reflect.get(decoded, 'tokenVersion');
  const tokenVersion =
    typeof tokenVersionRaw === 'number' && Number.isFinite(tokenVersionRaw)
      ? tokenVersionRaw
      : undefined;
  const tenantSlug = Reflect.get(decoded, 'tenant_slug');
  const sessionKind = Reflect.get(decoded, 'sessionKind');
  const sessionId = Reflect.get(decoded, 'sessionId');
  return { id, tokenVersion, tenant_slug: typeof tenantSlug === 'string' ? tenantSlug : undefined, sessionKind: typeof sessionKind === 'string' ? sessionKind : undefined, sessionId: typeof sessionId === 'string' ? sessionId : undefined };
}

async function validatePlatformSession(claims: TokenPayload) {
  if (!platformMode) return;
  if (!claims.sessionId || !['platform', 'tenant'].includes(claims.sessionKind || '') || !Number.isInteger(claims.tokenVersion)) throw new Error('Durable platform session required');
  const session = await readActivePlatformSession(prisma, claims.sessionId);
  if (session.userId !== claims.id || session.tokenVersion !== claims.tokenVersion) throw new Error('Platform session identity mismatch');
  if (!await prisma.platformOrganizationMembership.findFirst({ where: { userId: claims.id, active: true, organization: { active: true } }, select: { userId: true } })) throw new Error('Organization membership revoked');
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  if (platformMode && req.user?.['platformTenantAuthorized'] === true) return next();
  try {
    const token = extractAuthToken(req);

    if (!token) {
      logger.debug({ path: req.path }, 'No authentication token provided');
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
    }

    const decoded = parseTokenPayload(token);
    if (!decoded) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token payload' } });
    }

    await validatePlatformSession(decoded);

    // Check Cache
    const cached = userCache.get(decoded.id);
    if (!platformMode && cached && Date.now() < cached.expiresAt) {
      const cachedUser = cached.user;
      // Check Token Version if available in token
      if (decoded.tokenVersion !== undefined && cachedUser.tokenVersion !== decoded.tokenVersion) {
        logger.info({ userId: decoded.id, tokenVersion: decoded.tokenVersion, currentVersion: cachedUser.tokenVersion }, 'Token version mismatch (cached user)');
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Session invalid' } });
      }

      if (!cachedUser.isActive) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Account is disabled' } });
      }

      req.user = requestUser(cachedUser, decoded);
      return next();
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });

    if (!user) {
      logger.warn({ userId: decoded.id }, 'Authentication failed: user not found');
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not found' } });
    }

    // Check isActive
    if (!user.isActive || user.suspendedAt) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Account is disabled' } });
    }

    // Check Token Version
    if (decoded.tokenVersion !== undefined && user.tokenVersion !== decoded.tokenVersion) {
      logger.info({ userId: decoded.id, tokenVersion: decoded.tokenVersion, currentVersion: user.tokenVersion }, 'Token version mismatch');
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Session invalid' } });
    }

    // Update Cache
    userCache.set(decoded.id, { user, expiresAt: Date.now() + CACHE_TTL });

    // Prune cache occasionally (naive)
    if (userCache.size > 1000) {
      // Clear half the cache to prevent memory leak
      let i = 0;
      for (const key of userCache.keys()) {
        if (i++ > 500) break;
        userCache.delete(key);
      }
    }

    req.user = requestUser(user, decoded);
    next();
  } catch (error: unknown) {
    const name = typeof error === 'object' && error !== null ? String(Reflect.get(error, 'name') || '') : '';
    const message = typeof error === 'object' && error !== null ? String(Reflect.get(error, 'message') || '') : '';
    const expiredAt = typeof error === 'object' && error !== null ? String(Reflect.get(error, 'expiredAt') || '') : '';
    if (name === 'TokenExpiredError') {
      // Normal expiration - no need for alarm
      logger.debug({ expiredAt }, 'Token expired');
    } else if (name === 'JsonWebTokenError') {
      // Malformed/invalid token
      logger.warn({ error: message }, 'Invalid token format');
    } else {
      // System error
      logger.error({ err: error }, 'Token verification failed');
    }
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
};

export const authorize = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user || !roles.includes(user.role || '')) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    return next();
  };
};

export const BO_ROLES = ['ADMIN', 'UNDERWRITER', 'Program Administrator'] as const;
export const requireBO = authorize([...BO_ROLES]);

/**
 * True when the request carries an authenticated Back Office user. Requires a
 * prior `authenticate` / `optionalAuthenticate` to have populated `req.user`.
 * Used by public journey gates to let a logged-in admin bypass an OFF switch
 * (ADR-0101) while customers stay gated.
 */
export function isBackOfficeRequest(req: Request): boolean {
  const role = String(req.user?.role || '').trim();
  return (BO_ROLES as readonly string[]).includes(role);
}
// ... existing exports ...

export const optionalAuthenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (platformMode && req.user?.['platformTenantAuthorized'] === true) return void next();
  try {
    const token = extractAuthToken(req);

    if (!token) {
      // No token -> Guest
      return next();
    }

    // Reuse logic (copy-paste for safety/isolation or we could refactor)
    try {
      const decoded = parseTokenPayload(token);
      if (!decoded) return next();
      await validatePlatformSession(decoded);
      const cached = userCache.get(decoded.id);

      if (!platformMode && cached && Date.now() < cached.expiresAt) {
        if (decoded.tokenVersion !== undefined && cached.user.tokenVersion !== decoded.tokenVersion) {
          // Invalid session -> treat as guest
          return next();
        }
        if (!cached.user.isActive) return next();
        req.user = requestUser(cached.user, decoded);
        return next();
      }

      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (user && user.isActive && !user.suspendedAt) {
        if (decoded.tokenVersion === undefined || user.tokenVersion === decoded.tokenVersion) {
          userCache.set(decoded.id, { user, expiresAt: Date.now() + CACHE_TTL });
          req.user = requestUser(user, decoded);
        }
      }
    } catch (_err) {
      // Token invalid -> Guest
      // logger.warn('Optional Auth failed:', err);
    }
    return next();
  } catch (_error) {
    return next();
  }
};
