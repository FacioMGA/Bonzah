import type { NextFunction, Request, Response } from 'express';
import { logger } from '../../platform/utils/logger.js';
import {
  resolveCustomerPolicyAccess,
  type PolicyAccessActor,
} from '../../modules/policy/app/customerPolicyAccess.js';

export type { PolicyAccessActor };

/**
 * Policy access control.
 *
 * - ADMIN/UNDERWRITER: full access
 * - CUSTOMER: only own policies (canonical check in policy/app/customerPolicyAccess.ts)
 */
export async function requirePolicyAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user;
    const scopedAccountId = String(req.tenantId || '').trim();
    const actor = (user && scopedAccountId && String(user.role || '').toUpperCase() === 'CUSTOMER'
      ? { ...user, primaryAccountId: scopedAccountId }
      : user) as PolicyAccessActor;
    if (!actor) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const role = String(actor.role || '').toUpperCase();
    if (role === 'ADMIN' || role === 'UNDERWRITER') {
      return next();
    }
    if (role !== 'CUSTOMER') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }

    const policyId = String(req.params?.id || '').trim();
    if (!policyId) return next();

    const access = await resolveCustomerPolicyAccess(actor, policyId);
    if (access === 'missing') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
    }
    if (access === 'ok') return next();

    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
  } catch (error) {
    logger.error({ err: error }, '[PolicyAccess] Failed to enforce access');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to authorize request' } });
  }
}
