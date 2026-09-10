import type { Prisma } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { ApiResponse } from '../../../platform/types/index.js';

const router = Router();
type ErrorBody = ApiResponse<null>;

function policyHoldersAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

const ContactSchema = z.record(z.string(), z.unknown()).default({});

const BasePolicyHolderBodySchema = z.object({
  name: z.string().trim().optional(),
  segment: z.string().trim().optional(),
  address: z.string().trim().optional(),
  contact: ContactSchema.optional(),
  agent: z.string().trim().optional(),
  agentContact: ContactSchema.optional(),
});

const UpdateParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});

function jsonStringify(data: unknown): string {
  return JSON.stringify(data);
}

function jsonParse(data: string | null): Record<string, unknown> {
  if (!data) return {};
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function actorFromRequest(req: { user?: Express.UserTokenPayload }) {
  const user = req.user;
  return {
    id: user && typeof user.id === 'string' ? user.id : 'system',
    name: user && typeof user.name === 'string' ? user.name : undefined,
    email: user && typeof user.email === 'string' ? user.email : undefined,
  };
}

function sendError(res: { status: (code: number) => { json: (payload: ErrorBody) => unknown } }, status: number, code: string, message: string) {
  const payload: ErrorBody = {
    success: false,
    error: { code, message },
  };
  return res.status(status).json(payload);
}

/**
 * POST /api/policy-holders
 * Create a new Policy Holder
 */
router.post('/', policyHoldersAuditLog, async (req, res) => {
  try {
    const body = BasePolicyHolderBodySchema.parse(req.body);
    const combinedContact = {
      ...(body.contact || {}),
      agent: body.agent,
      agentContact: body.agentContact,
    };

    const ph = await tenantScopedPrisma.policyHolder.create({
      data: {
        name: body.name || 'New Client',
        segment: body.segment || 'Real Estate',
        address: body.address,
        contact: jsonStringify(combinedContact),
      } as unknown as Prisma.PolicyHolderUncheckedCreateInput,
    });

    const actor = actorFromRequest(req);
    const actorName = actor.name || actor.email || 'Unknown User';
    const { AuditLogger } = await import('../../../platform/audit/logger.js');
    await AuditLogger.log(
      ph.id,
      'POLICY',
      'ACCOUNT.CREATED',
      actor.id,
      'USER',
      {
        name: ph.name,
        segment: ph.segment,
      },
      actorName
    );

    return res.status(201).json({
      success: true,
      data: ph,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid request body');
    }
    return sendError(res, 500, 'CREATE_ERROR', error instanceof Error ? error.message : String(error));
  }
});

/**
 * PUT /api/policy-holders/:id
 * Update Policy Holder details
 */
router.put('/:id', policyHoldersAuditLog, async (req, res) => {
  try {
    const { id } = UpdateParamsSchema.parse(req.params);
    const body = BasePolicyHolderBodySchema.parse(req.body);

    const existing = await tenantScopedPrisma.policyHolder.findUnique({ where: { id } });
    if (!existing) {
      return sendError(res, 404, 'NOT_FOUND', 'Policy Holder not found');
    }

    const existingContact = jsonParse(existing.contact);
    const combinedContact = {
      ...existingContact,
      ...(body.contact || {}),
      agent: body.agent,
      agentContact: body.agentContact,
    };

    const updated = await tenantScopedPrisma.policyHolder.update({
      where: { id },
      data: {
        name: body.name,
        segment: body.segment,
        address: body.address,
        contact: jsonStringify(combinedContact),
      },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid request');
    }
    return sendError(res, 500, 'UPDATE_ERROR', error instanceof Error ? error.message : String(error));
  }
});

export default router;
