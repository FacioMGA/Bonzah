import type { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response, Router } from 'express';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { DocumentService } from '../../documents/app/documentService.js';
import { enqueuePolicyListIndexUpdate } from '../app/policyListIndex.js';
import { transitionPolicyLifecycle } from '../app/commands/policyLifecycleCommands.js';
import { resolvePublicAppBaseUrlFromRequest } from '../../../platform/http/publicAppLinks.js';
import { sendRevisedQuoteUseCase } from '../app/quoteLifecycle/sendRevisedQuoteUseCase.js';

import { logger } from '../../../platform/utils/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
function actorFromRequest(req: { user?: Express.UserTokenPayload }) {
  const user = req.user;
  return {
    id: user && typeof user.id === 'string' ? user.id : undefined,
    name: user && typeof user.name === 'string' ? user.name : undefined,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function resolveQuoteBaseUrl(req: { protocol?: string; get?: (name: string) => string | undefined; headers?: Record<string, unknown> }): string {
  return resolvePublicAppBaseUrlFromRequest(req);
}

function policyAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

/**
 * Quote lifecycle + quote sharing routes.
 */
export function registerPolicyQuoteRoutes(router: Router) {
  /**
   * POST /api/policies/:id/quote
   * Command: Transition to QUOTED status (with validations)
   */
  router.post('/:id/quote', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;

      // 1. Fetch Policy
      const policy = await tenantScopedPrisma.policy.findUnique({ where: { id } });
      if (!policy) return res.status(404).json({ success: false, error: 'Policy not found' });

      // 2. Validate Transition
      if (policy.status !== 'DRAFT') {
        return res.status(400).json({ success: false, error: 'Policy must be in DRAFT to Quote' });
      }

      // 3. Update Status
      const updated = await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        await transitionPolicyLifecycle({
          tx,
          policyId: id,
          to: 'QUOTED',
          actorId: actorFromRequest(req).id || 'system',
          actorType: 'USER',
          reasonCode: 'QUOTE_GENERATED',
          correlationId: req.correlationId,
          data: { source: 'policies/quote.post' },
        });
        const next = await tx.policy.findUniqueOrThrow({ where: { id } });
        await enqueuePolicyListIndexUpdate(tx, id);
        return next;
      });

      // 4. Update Search Index
      try {
        await tenantScopedPrisma.policySearchIndex.update({
          where: { policyId: id },
          data: { status: 'QUOTED' }
        });
      } catch (_e) { }

      // 5. Audit
      const user = actorFromRequest(req);
      void AuditLogger.log(id, 'POLICY', 'POLICY.QUOTED', user?.id || 'system', 'USER', {
        previousStatus: 'DRAFT'
      }, user?.name);

      return res.json({ success: true, data: updated });

    } catch (error) {
      logger.error({ err: error }, 'Quote error:');
      return res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  /**
   * GET /api/policies/:id/quote/draft
   * Generate PDF Quote
   */
  router.get('/:id/quote/draft', policyAuditLog, async (req, res) => {
    try {
      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: req.params.id },
        include: { policyHolder: true }
      });

      if (!policy) return res.status(404).send('Policy not found');

      // Generate a deterministic QUOTE_PACK PDF that mirrors the schedule semantics.
      const actor = actorFromRequest(req);
      const pack = await DocumentService.generate({
        policyId: policy.id,
        riskTransactionId: null,
        docPack: 'QUOTE_PACK',
        source: 'BO',
        generatedByUserId: actor.id || null,
      });
      const documents = Array.isArray(pack.documents) ? pack.documents : [];
      const doc = documents.find((d) => String(parseRecord(d).type || '').includes('QUOTE')) || documents[0];
      const docRecord = parseRecord(doc);
      if (!docRecord.storageUri) {
        return res.status(500).json({ success: false, error: { code: 'GENERATION_FAILED', message: 'Quote pack generated but no document URL returned' } });
      }
      return res.json({
        success: true,
        data: {
          url: String(docRecord.storageUri),
          googleDocUrl: String(docRecord.storageUri),
          localUrl: String(docRecord.storageUri),
          status: 'generated',
          doc,
        },
      });

    } catch (error) {
      logger.error({ err: error }, 'Quote Draft Error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error generating quote draft', details: errorMessage(error, 'Quote draft error') } });
    }
  });

  /**
   * POST /api/policies/:id/quote/send
   * Email the PDF Quote
   */
  router.post('/:id/quote/send', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const actor = actorFromRequest(req);
      // Delegate to the canonical service (operator MCP V2 / ADR-0039 §2).
      // Same writes / audit / lifecycle / outbox as the previous inline path.
      const result = await sendRevisedQuoteUseCase({
        policyId: id,
        actor: {
          id: actor.id || 'system',
          role: actor.id ? 'UNDERWRITER' : 'SYSTEM',
          name: actor.name,
        },
        correlationId: req.correlationId,
        publicAppBaseUrl: resolveQuoteBaseUrl(req),
      });
      if (!result.ok) {
        const statusCode = result.code === 'NOT_FOUND'
          ? 404
          : result.code === 'MISSING_EMAIL' || result.code === 'PRODUCT_ASSIGNMENT_REQUIRED'
          ? 422
          : result.code === 'INVALID_STATUS'
          ? 409
          : 500;
        return res.status(statusCode).json({
          success: false,
          error: { code: result.code, message: result.message },
        });
      }
      logger.info({
        event: 'policy.quote.send.queued',
        policyId: id,
        recipient: result.recipient,
        messageId: result.messageId,
        lifecycleRecorded: result.lifecycleRecorded,
        correlationId: req.correlationId,
      }, 'policy.quote.send.queued');
      return res.json({
        success: true,
        data: {
          status: result.status,
          timestamp: new Date(),
          recipient: result.recipient,
          url: result.url,
          messageId: result.messageId,
          lifecycleRecorded: result.lifecycleRecorded,
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Quote send failed') } });
    }
  });
}
