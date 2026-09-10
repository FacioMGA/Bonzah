/**
 * Communication Permissions — guards for internal note visibility and approval workflows.
 *
 * Rules:
 * - INTERNAL_NOTE messages are only visible to users with ADMIN or UNDERWRITER roles
 * - SYSTEM_EVENT messages are visible to all authenticated users
 * - EXTERNAL messages are visible based on entity access (handled by existing auth middleware)
 * - Templates with approvalRequired=true need ADMIN/UNDERWRITER to send
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';

const INTERNAL_ROLES = ['ADMIN', 'UNDERWRITER'];
const PermissionsBodySchema = z.object({
    communicationType: z.string().optional(),
    templateId: z.string().optional(),
});

/**
 * Get the user's role from the request (set by auth middleware upstream).
 */
function getUserRole(req: Request): string | undefined {
    return typeof req.user?.role === 'string' ? req.user.role : undefined;
}

/**
 * Check if the current user can view internal notes.
 */
export function canViewInternalNotes(req: Request): boolean {
    const role = getUserRole(req);
    return Boolean(role && INTERNAL_ROLES.includes(role));
}

/**
 * Check if the current user can create internal notes.
 */
export function canCreateInternalNotes(req: Request): boolean {
    return canViewInternalNotes(req);
}

/**
 * Check if the current user can send messages requiring approval.
 */
export function canSendWithoutApproval(req: Request): boolean {
    const role = getUserRole(req);
    return Boolean(role && INTERNAL_ROLES.includes(role));
}

/**
 * Filter messages based on visibility rules.
 * Strips INTERNAL_NOTE messages from non-internal users.
 */
export function filterMessagesByPermission<T extends { communicationType?: string | null }>(
    messages: T[],
    req: Request,
): T[] {
    if (canViewInternalNotes(req)) return messages;
    return messages.filter((m) => m.communicationType !== 'INTERNAL_NOTE');
}

/**
 * Middleware: guard that blocks INTERNAL_NOTE creation for non-internal users.
 */
export function guardInternalNoteCreation(req: Request, res: Response, next: NextFunction): void {
    const parsed = PermissionsBodySchema.safeParse(req.body || {});
    const commType = parsed.success ? parsed.data.communicationType : undefined;

    if (commType === 'INTERNAL_NOTE' && !canCreateInternalNotes(req)) {
        res.status(403).json({
            success: false,
            error: { message: 'Only internal users (ADMIN/UNDERWRITER) can create internal notes' },
        });
        return;
    }

    next();
}

/**
 * Middleware: guard that blocks sending approval-required templates for non-internal users.
 */
export async function guardTemplateApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const parsed = PermissionsBodySchema.safeParse(req.body || {});
        const templateId = parsed.success ? parsed.data.templateId : undefined;

        if (!templateId) {
            next();
            return;
        }

        const template = await tenantScopedPrisma.communicationTemplate.findUnique({
            where: { id: templateId },
            select: { approvalRequired: true },
        });

        if (template?.approvalRequired && !canSendWithoutApproval(req)) {
            res.status(403).json({
                success: false,
                error: { message: 'This template requires ADMIN/UNDERWRITER approval to send' },
            });
            return;
        }

        next();
    } catch (error) {
        logger.error({ err: error }, 'Template approval guard error');
        next();
    }
}
