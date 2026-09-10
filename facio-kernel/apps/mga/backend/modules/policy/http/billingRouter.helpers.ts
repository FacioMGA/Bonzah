import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { errorMessage } from '../../../platform/http/httpErrors.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
export { errorMessage, parseRecord };

export function parseSnapshotValue(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return parseRecord(value);
}

export function actorFromRequest(req: { user?: Express.UserTokenPayload }) {
  const user = req.user;
  return {
    id: user && typeof user.id === 'string' ? user.id : undefined,
    name: user && typeof user.name === 'string' ? user.name : undefined,
    role: user && typeof user.role === 'string' ? user.role : undefined,
  };
}

export function getMethod(target: unknown, methodName: string): ((...args: unknown[]) => unknown) | null {
  const obj = parseRecord(target);
  const method = obj[methodName];
  return typeof method === 'function' ? (...args: unknown[]) => method(...args) : null;
}

export function toJsonOrNull(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  return toInputJson(value);
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonOrNull(item));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = toJsonOrNull(v);
    }
    return out;
  }
  return {};
}

export function logAuditEvent(
  policyId: string,
  eventType: string,
  actor: { id?: string; role?: string; name?: string },
  payload: Record<string, unknown>
): void {
  const log = getMethod(AuditLogger, 'log');
  log?.(
    policyId,
    'POLICY',
    eventType,
    actor.id || 'system',
    actor.role ? 'USER' : 'SYSTEM',
    payload,
    actor.name
  );
}

export function policyAuditLog(req: Request, _res: Response, next: NextFunction): void {
  try {
    const correlationId = (req.headers['x-correlation-id'] as string) || req.correlationId;
    const actionId = req.headers['x-action-id'] as string;
    const tenantId = String(req.headers['x-tenant-id'] || '').trim() || undefined;
    const textUser = req.user;
    const actorId = textUser?.id || 'system';
    const actorType = textUser?.role || 'SYSTEM';
    req.auditContext = { correlationId, actionId, tenantId, actorId, actorType };
    next();
  } catch {
    next();
  }
}

export type RouterUseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export function sendUseCaseResponse(res: Response, result: RouterUseCaseResult) {
  return res.status(result.status).json(result.body);
}

export function sendRouterError(
  res: Response,
  args: {
    logger: { error: (payload: Record<string, unknown>, message: string) => void };
    error: unknown;
    logMessage: string;
    fallbackMessage: string;
  }
) {
  args.logger.error({ err: args.error }, args.logMessage);
  return res.status(500).json({
    success: false,
    error: { code: 'SERVER_ERROR', message: errorMessage(args.error, args.fallbackMessage) },
  });
}
