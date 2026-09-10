import type { NextFunction, Request, Response } from 'express';

export type AuditContext = Express.AuditContext;

export async function claimsAuditLog(req: Request, _res: Response, next: NextFunction): Promise<void> {
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
