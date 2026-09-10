/**
 * permissionMiddleware.ts
 *
 * Factory: requirePermission(resource, action)
 *
 * DESIGN:
 * - Permissions are resolved from DB once per request and cached on req
 * - Uses the pure can() function from domain/permissions.ts
 * - Fails closed with distinct codes for missing auth, denial, and resolver failure
 */
import type { NextFunction } from 'express';
import { logger } from '../../../platform/utils/logger.js';
import {
  hasEffectivePermission,
  resolveEffectivePermissionsForUser,
  type ResolvedPermission,
} from '../app/permissionService.js';

/** Augment Express Request to carry the resolved permission set for this user. */
declare global {
  namespace Express {
    interface Request {
      resolvedPermissions?: ResolvedPermission[];
    }
  }
}

type PermissionRequest = {
  user?: Express.UserTokenPayload;
  resolvedPermissions?: ResolvedPermission[];
};

type DocumentPermissionRequest = PermissionRequest & {
  query?: { inline?: unknown };
};

type PermissionResponse = {
  status(code: number): { json(body: unknown): unknown };
};

/** Lazily resolves and caches the permission set for the authenticated user. */
async function resolvePermissions(req: PermissionRequest): Promise<ResolvedPermission[]> {
  if (req.resolvedPermissions) return req.resolvedPermissions;

  const userId = req.user?.id;
  if (!userId) throw new Error('Authenticated user id is missing');

  const resolved = await resolveEffectivePermissionsForUser(userId, req.user?.role);
  req.resolvedPermissions = resolved;
  return resolved;
}

async function enforcePermissionKey(
  req: PermissionRequest,
  res: PermissionResponse,
  key: string,
): Promise<boolean> {
  const user = req.user;

  if (!user?.id) {
    logger.error({ key }, '[permissionMiddleware] Missing authenticated user');
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required before permission checks run.',
      },
    });
    return false;
  }

  try {
    const permissions = await resolvePermissions(req);
    const allowed = hasEffectivePermission(permissions, key);

    if (!allowed) {
      logger.warn({ userId: user.id, role: user.role, key }, '[permissionMiddleware] Access denied');
      res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: `You do not have permission to perform this action (${key}).`,
        },
      });
      return false;
    }
  } catch (err) {
    logger.error({ err, key, userId: user.id }, '[permissionMiddleware] Permission check failed');
    res.status(503).json({
      success: false,
      error: { code: 'PERMISSION_CHECK_FAILED', message: 'Permission check could not be completed.' },
    });
    return false;
  }

  return true;
}

/**
 * Creates an Express middleware that enforces a single fine-grained permission.
 *
 * Usage:
 *   router.post('/claims', requirePermission('claims', 'create'), handler)
 *
 * All users must have the permission in their resolved set.
 */
export function requirePermission(resource: string, action: string) {
  const key = `${resource}.${action}`;

  return async (req: PermissionRequest, res: PermissionResponse, next: NextFunction): Promise<void> => {
    if (!(await enforcePermissionKey(req, res, key))) return;
    next();
  };
}

/**
 * Document fetch gate: inline viewing uses documents.view; file download uses
 * documents.download. Staff hold view-only; manager authority adds download.
 */
export function requireDocumentFetchPermission() {
  return async (req: DocumentPermissionRequest, res: PermissionResponse, next: NextFunction): Promise<void> => {
    const inline = String(req.query?.inline || '') === '1';
    const key = inline ? 'documents.view' : 'documents.download';
    if (!(await enforcePermissionKey(req, res, key))) return;
    next();
  };
}
