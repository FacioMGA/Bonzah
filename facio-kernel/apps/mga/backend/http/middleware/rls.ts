import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../platform/utils/logger.js';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { getTenantConfig } from '../../platform/tenant/tenantConfig.js';
import { resolveTenantOrThrow, TenantResolutionError } from '../../platform/tenant/tenantResolution.js';
import {
    withTenantContext as withTenantContextTx,
    withSystemContext as withSystemContextTx,
    withCrossTenantAccess as withCrossTenantAccessTx,
} from '../../platform/db/tenantContext.js';

/**
 * Account-Scope Context Middleware
 *
 * Sets `req.tenantId` (the customer account UUID) which drives the
 * `app.current_account_id` Postgres GUC for customer-account-level RLS.
 * This is the *second* isolation axis — the first is `app.operating_tenant_id`
 * (MGA / jurisdiction), set earlier by `resolveOperatingTenant`.
 *
 * CRITICAL SECURITY: This middleware MUST run after `authenticate` and BEFORE
 * any database queries to ensure proper customer-account isolation.
 */
export async function setAccountScopeContext(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const user = req.user;
        const role = String(user?.role || '').toUpperCase();
        if (role === 'CUSTOMER' && user?.id) {
            const tenantId = getTenantConfig().id;
            const memberships = await tenantScopedPrisma.accountUser.findMany({
              where: {
                userId: user.id,
                account: { operatingTenantId: tenantId },
              },
              select: { accountId: true },
              take: 2,
            });
            if (memberships.length > 1) {
                throw new Error('CUSTOMER_ACCOUNT_TENANT_INVARIANT_BREACH');
            }
            const scopedAccountId = String(memberships[0]?.accountId || '').trim();
            if (scopedAccountId) {
                req.tenantId = scopedAccountId;
                res.locals.tenantAccountId = scopedAccountId;
                return next();
            }
        }

        const tenantId = resolveTenantOrThrow(req, 'authenticated');
        req.tenantId = tenantId;
        res.locals.tenantAccountId = tenantId;
        return next();
    } catch (error) {
        if (error instanceof TenantResolutionError) {
            return void res.status(error.statusCode).json({
                success: false,
                error: { code: error.code, message: error.message },
            });
        }
        logger.error({ err: error, path: req.path, method: req.method }, 'RLS: Failed to resolve tenant context');
        return void res.status(500).json({
            success: false,
            error: { code: 'TENANT_CONTEXT_ERROR', message: 'Failed to resolve tenant context' },
        });
    }
}

/**
 * System Context Wrapper
 * 
 * Executes a function with SYSTEM privileges, bypassing RLS.
 * Use ONLY for administrative operations like migrations and cron jobs.
 * 
 * WARNING: This grants cross-tenant access. Use with extreme caution
 * and always include audit logging.
 * 
 * @example
 * await withSystemContext(async () => {
 *   // use bare prisma here — system context bypasses RLS intentionally
 * });
 */
export async function withSystemContext<T>(
    fn: Parameters<typeof withSystemContextTx<T>>[0]
): Promise<T> {
    return withSystemContextTx(fn);
}

/**
 * Cross-Tenant Query Wrapper
 * 
 * Temporarily disables RLS for specific cross-tenant queries.
 * Use ONLY when explicitly authorized (e.g., bordereaux aggregation).
 * 
 * WARNING: Always validate authorization before using this function.
 * All usage should be logged for audit purposes.
 * 
 * @param accountIds - List of authorized accounts for this query
 * @param fn - Function to execute without RLS
 */
export async function withCrossTenantAccess<T>(
    accountIds: string[],
    fn: Parameters<typeof withCrossTenantAccessTx<T>>[1]
): Promise<T> {
    return withCrossTenantAccessTx(accountIds, fn);
}

export async function withTenantContext<T>(
    accountId: string,
    fn: Parameters<typeof withTenantContextTx<T>>[1],
): Promise<T> {
    return withTenantContextTx(accountId, fn);
}
