import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { MagicBService, MagicBRegistry, logger } from '../app/mbeDeps.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
type MbeRouterDeps = {
  auditLog: RequestHandler;
};

const MbeMutationBodySchema = z.object({
  policyId: z.string().trim().min(1, 'policyId is required'),
  endorsementCode: z.string().trim().min(1, 'endorsementCode is required'),
  params: z.record(z.string(), z.unknown()).optional(),
  targetId: z.string().trim().min(1).optional(),
});

const IdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function actorIdFromRequest(req: { user?: Express.UserTokenPayload }): string {
  return req.user && typeof req.user.id === 'string' ? req.user.id : 'system';
}

export function createMbeRouter({ auditLog }: MbeRouterDeps) {
  const router = Router();

  /**
   * Resolve the product type for a template request.
   * Priority:
   *   1. Explicit `?productType=` query param.
   *   2. `?policyId=` → policy.productType.
   *   3. `?programId=` → program.productType.
   *
   * Returns a typed error (422) when no product can be resolved. There is no
   * "default" — the MBE catalog is never motor-by-assumption.
   */
  async function resolveProductTypeFromQuery(query: Record<string, unknown>): Promise<string | null> {
    const explicit = String(query.productType || '').trim().toUpperCase();
    if (explicit) return explicit;
    const policyId = String(query.policyId || '').trim();
    if (policyId) {
      const p = await tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { productType: true } });
      if (p?.productType) return String(p.productType).toUpperCase();
    }
    const programId = String(query.programId || '').trim();
    if (programId) {
      const p = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { productType: true } });
      if (p?.productType) return String(p.productType).toUpperCase();
    }
    return null;
  }

  router.get('/templates', auditLog, async (req, res) => {
    try {
      const productType = await resolveProductTypeFromQuery(req.query as Record<string, unknown>);
      if (!productType) {
        res.status(422).json({ success: false, error: 'productType, policyId, or programId query param is required' });
        return;
      }
      const catalog = MagicBRegistry.forProduct(productType);
      res.json({ success: true, data: catalog.getAll() });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.get('/groups', auditLog, async (req, res) => {
    try {
      const productType = await resolveProductTypeFromQuery(req.query as Record<string, unknown>);
      if (!productType) {
        res.status(422).json({ success: false, error: 'productType, policyId, or programId query param is required' });
        return;
      }
      const catalog = MagicBRegistry.forProduct(productType);
      res.json({ success: true, data: catalog.getGroups() });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.post('/preview', auditLog, async (req, res) => {
  try {
    const payload = MbeMutationBodySchema.parse(req.body);
    const result = await MagicBService.previewEndorsement(
      payload.policyId,
      payload.endorsementCode,
      payload.params || {},
      payload.targetId,
    );
    return res.json({ success: true, data: result });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: e.issues[0]?.message || 'Invalid request body' });
    }
    logger.error({ err: e }, 'MBE Preview error:');
    return res.status(500).json({ success: false, error: errorMessage(e, 'Preview failed') });
  }
  });

  router.post('/apply', auditLog, async (req, res) => {
  try {
    const payload = MbeMutationBodySchema.parse(req.body);
    const userId = actorIdFromRequest(req);
    const instance = await MagicBService.applyEndorsement(
      userId,
      payload.policyId,
      payload.endorsementCode,
      payload.params || {},
      payload.targetId,
    );
    return res.json({ success: true, data: instance });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: e.issues[0]?.message || 'Invalid request body' });
    }
    logger.error({ err: e }, 'MBE Apply error:');
    return res.status(500).json({ success: false, error: errorMessage(e, 'Apply failed') });
  }
  });

  router.delete('/endorsements/:id', auditLog, async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    const userId = actorIdFromRequest(req);
    const updated = await MagicBService.supersedeEndorsement(id, userId);
    return res.json({ success: true, data: updated });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: e.issues[0]?.message || 'Invalid id' });
    }
    logger.error({ err: e }, 'MBE Supersede error:');
    return res.status(500).json({ success: false, error: errorMessage(e, 'Supersede failed') });
  }
  });

  router.post('/endorsements/:id/approve', auditLog, async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    const userId = actorIdFromRequest(req);
    const result = await MagicBService.approveEndorsement(id, userId);
    return res.json({ success: true, data: result });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: e.issues[0]?.message || 'Invalid id' });
    }
    logger.error({ err: e }, 'MBE Approve error:');
    return res.status(500).json({ success: false, error: errorMessage(e, 'Approve failed') });
  }
  });

  router.post('/endorsements/:id/decline', auditLog, async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    const userId = actorIdFromRequest(req);
    const result = await MagicBService.declineEndorsement(id, userId);
    return res.json({ success: true, data: result });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: e.issues[0]?.message || 'Invalid id' });
    }
    logger.error({ err: e }, 'MBE Decline error:');
    return res.status(500).json({ success: false, error: errorMessage(e, 'Decline failed') });
  }
  });

  return router;
}
