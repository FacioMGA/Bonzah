import { NextFunction, Request, Response } from 'express';
import { BO_ROLES } from '../../platform/http/middleware/auth.js';

export type ApiSurface = 'public' | 'client' | 'bo';

function readSurfaceHeader(req: Request): ApiSurface | null {
  const raw = String(req.headers['x-facio-surface'] || '').trim().toLowerCase();
  if (raw === 'public' || raw === 'client' || raw === 'bo') return raw;
  return null;
}

function inferSurfaceFromAuth(req: Request): ApiSurface {
  const role = String(req.user?.role || '').trim();
  if (role && BO_ROLES.includes(role as (typeof BO_ROLES)[number])) return 'bo';
  if (req.user) return 'client';
  return 'public';
}

export function resolveRequestSurface(req: Request): ApiSurface {
  return readSurfaceHeader(req) || inferSurfaceFromAuth(req);
}

export function requireSurfaceAccess(allowed: ApiSurface[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const resolved = resolveRequestSurface(req);
    req.apiSurface = resolved;

    if (!allowed.includes(resolved)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Surface ${resolved} is not allowed for this route`,
        },
      });
    }
    return next();
  };
}
