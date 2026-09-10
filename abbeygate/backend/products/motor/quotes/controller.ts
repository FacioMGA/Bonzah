/**
 * controller.ts — Public auto quote HTTP handlers (slim shell).
 *
 * Retains 9 lean CRUD/lifecycle handlers.
 * Extracted modules:
 *   - controllerUtils.ts — shared utilities (policyIdFrom, sendPublicError, PDF helpers)
 *   - quoteEmailHandler.ts — sendQuoteEmailHandler (heaviest handler: JWT, PDF, email)
 *   - recoHandlers.ts — getRecommendationsHandler, recoEventHandler
 */
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asRecord } from './quoteDataGuards.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { DocumentService } from '../../../modules/documents/app/documentService.js';
import { jsonStringify } from '../../../modules/policy/app/shared.js';
import { logger } from '../../../platform/utils/logger.js';
import { attemptIssuanceHealForPolicy } from '../../../modules/payments/app/cardcorpIssuanceHealService.js';

import {
  type RequestWithPerf,
  policyIdFrom,
  resolveCorrelationId,
  sendPublicError,
} from './controllerUtils.js';

// ── Re-exports for handler façade stability ────────────────────

export { sendQuoteEmailHandler } from './quoteEmailHandler.js';
export { getRecommendationsHandler, recoEventHandler } from './recoHandlers.js';

// ── Dynamic module imports ─────────────────────────────────────

type PublicSessionModule = typeof import('./publicSession.js');
type PublicSessionCacheModule = typeof import('./publicSessionCache.js');
type PublicSchemasModule = typeof import('./schemas.js');
type ErrorsModule = typeof import('./errors.js');
type PublicServiceModule = typeof import('./service.js');
const publicSessionModule: PublicSessionModule = await import('./publicSession.js');
const publicSessionCacheModule: PublicSessionCacheModule = await import('./publicSessionCache.js');
const publicSchemasModule: PublicSchemasModule = await import('./schemas.js');
const errorsModule: ErrorsModule = await import('./errors.js');
const publicServiceModule: PublicServiceModule = await import('./service.js');
const { enforcePublicToken, resolvePublicAutoPolicyFull, resolvePublicAutoPolicyLight } = publicSessionModule;
const { invalidateCachedLightByToken } = publicSessionCacheModule;
const { CreateSessionBodySchema, PatchSessionBodySchema, RateSessionBodySchema } = publicSchemasModule;
const { PublicApiError } = errorsModule;
const {
  createPublicAutoSession,
  forkPublicAutoPolicy,
  getOrQueuePublicIssuedPackLinks,
  getPublicIssueReadiness,
  rateQuote,
  unlockPublicAutoPolicy,
  updatePublicAutoDraft,
} = publicServiceModule;
const CallbackRequestBodySchema = z.object({
  name: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().optional(),
  bestTimeToCall: z.string().trim().optional(),
  reference: z.string().trim().optional(),
});
const GenerateQuotePackBodySchema = z.object({
  docPack: z.string().trim().optional().default('QUOTE_PACK'),
});

// ── Handlers ───────────────────────────────────────────────────

export async function createSessionHandler(req: Request, res: Response) {
  try {
    const parsed = CreateSessionBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid request body', details: parsed.error.flatten() },
      });
    }
    const { sessionKey, origin, vehicleType } = parsed.data;

    const data = await createPublicAutoSession({
      sessionKey,
      origin,
      vehicleType,
    });

    return res.json({ success: true, data });
  } catch (e) {
    return sendPublicError(res, e, 'Create session failed');
  }
}

export async function getSessionHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithPerf;
    const policyId = policyIdFrom(req);
    const resolved = await resolvePublicAutoPolicyFull(policyId, { perf: request.perf });
    const policy = resolved.policy;
    if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    if (!enforcePublicToken(request, resolved.mode, res)) return;
    const snapshot = asRecord(asRecord(policy.stateCurrent).snapshot);
    const snapshotQuoteData = asRecord(snapshot.quoteData);
    const snapshotQuoteResponse = snapshot.quoteResponse;
    const canonicalQuoteData = Object.keys(snapshotQuoteData).length > 0 ? snapshotQuoteData : asRecord(policy.quoteData);
    const canonicalQuoteResponse =
      snapshotQuoteResponse && typeof snapshotQuoteResponse === 'object'
        ? snapshotQuoteResponse
        : policy.quoteResponse;

    return res.json({
      success: true,
      data: {
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        publicSessionToken: policy.publicSessionToken,
        status: policy.status,
        isLocked: Boolean(policy.isLocked),
        snapshot: {
          quoteData: canonicalQuoteData,
          quoteResponse: canonicalQuoteResponse,
          coverageSelection: asRecord(snapshot.coverageSelection),
          step: typeof snapshot.step === 'string' ? snapshot.step : null,
          source: 'policyStateCurrent.snapshot',
        },
      },
    });
  } catch (e) {
    return sendPublicError(res, e, 'Get session failed');
  }
}

export async function requestCallbackHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithPerf;
    const policyId = policyIdFrom(req);
    const resolved = await resolvePublicAutoPolicyLight(policyId, { perf: request.perf });
    const policy = resolved.policy;
    if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    if (!enforcePublicToken(request, resolved.mode, res)) return;

    const parsed = CallbackRequestBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid callback request payload', details: parsed.error.flatten() },
      });
    }
    const payload = parsed.data;
    const nowIso = new Date().toISOString();
    const existingState = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: policy.id }, select: { snapshot: true } });
    const existingSnapshot = asRecord(existingState?.snapshot);
    const existingCustomerFlow = asRecord(existingSnapshot.customerFlow);

    // Persist a lightweight trace in policy_state_current (best-effort).
    await tenantScopedPrisma.policyStateCurrent.upsert({
      where: { policyId: policy.id },
      update: {
        snapshot: jsonStringify({
          ...existingSnapshot,
          customerFlow: {
            ...existingCustomerFlow,
            callbackRequestedAt: nowIso,
            callbackRequest: {
              name: payload.name || null,
              email: payload.email || null,
              phone: payload.phone || null,
              bestTimeToCall: payload.bestTimeToCall || null,
              reference: payload.reference || null,
            },
          },
        }),
      },
      create: {
        policyId: policy.id,
        snapshot: jsonStringify({
          customerFlow: {
            callbackRequestedAt: nowIso,
            callbackRequest: {
              name: payload.name || null,
              email: payload.email || null,
              phone: payload.phone || null,
              bestTimeToCall: payload.bestTimeToCall || null,
              reference: payload.reference || null,
            },
          },
        }),
      } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
    }).catch(() => undefined);

    void AuditLogger.log(
      policy.id,
      'POLICY',
      'AUTO_QUOTE.CALLBACK_REQUESTED',
      'customer',
      'USER',
      { ...payload, requestedAt: nowIso },
      String(payload.name || payload.email || 'Customer')
    );

    return res.json({ success: true, data: { requestedAt: nowIso } });
  } catch (e) {
    return sendPublicError(res, e, 'Request callback failed');
  }
}

export async function getIssueReadinessHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithPerf;
    const policyId = policyIdFrom(req);
    const resolved = await resolvePublicAutoPolicyLight(policyId, { perf: request.perf });
    const policy = resolved.policy;
    if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    if (!enforcePublicToken(request, resolved.mode, res)) return;

    // ABY-70 — durable self-heal for the "PAID-but-no-INCEPTION" zombie.
    // The PaymentStep `pending_issuance` UI polls THIS route every ~1.6s
    // after CardCorp redirect, so it's the only HTTP surface guaranteed
    // to be re-hit when the issuance spine never wrote an INCEPTION row
    // (sanctions timeout, premium drift, OOM, etc. between the PAID
    // commit and the issuance commit). The probe is a fast no-op unless
    // BOTH `payment.status === 'PAID'` AND no INCEPTION exists; when it
    // fires it re-runs the canonical `runCardcorpPaidIssuance` which
    // is idempotent at the DB layer and re-enqueues the issued-pack
    // outbox event under a deterministic idempotencyKey. We `await`
    // (with an in-process per-policy lock) so the readiness response
    // observed by the very next poll already reflects ACTIVE+INCEPTION.
    await attemptIssuanceHealForPolicy({
      policy: { id: policy.id, policyNumber: policy.policyNumber, productType: policy.productType },
      correlationId: req.correlationId,
    });

    // Load lightweight projection
    const pRead = await tenantScopedPrisma.policy.findUnique({
      where: { id: policy.id },
      select: { issueReadiness: true }
    });

    if (pRead?.issueReadiness) {
      const proj = pRead.issueReadiness as Record<string, unknown>;
      const version = proj.version || 0;

      // Reconstruct the exact shape the frontend expects (derived object + customerOutcome)
      const readinessData = {
        channel: 'customer',
        policyId: policy.id,
        canIssue: proj.customerOutcome === 'issued', // derived from customerOutcome for UI logic
        customerOutcome: proj.customerOutcome,
        derived: {
          hasBoundInceptionTransaction: proj.hasBoundInceptionTransaction === true,
          hasIssuedPackDocuments: proj.hasIssuedPackDocuments === true,
          hasWelcomeEmailSent: proj.hasWelcomeEmailSent === true,
        }
      };
      // Projection is monotonic and can lag; serve live readiness until issued.
      if (readinessData.customerOutcome !== 'issued') {
        const readiness = await getPublicIssueReadiness({ policyId: policy.id });
        return res.json({ success: true, data: readiness });
      }
      const etag = `W/"v${version}"`;
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
      return res.json({ success: true, data: readinessData });
    }

    // Fallback: If no projection exists (e.g. inflight session before binding, or older session),
    // we drop back to the heavy evaluation and return that.
    const readiness = await getPublicIssueReadiness({ policyId: policy.id });
    return res.json({ success: true, data: readiness });
  } catch (e) {
    logger.error(
      {
        err: e,
        pathPolicyId: policyIdFrom(req),
        correlationId: req.correlationId,
      },
      '[getIssueReadinessHandler] Issue readiness failed'
    );
    return sendPublicError(res, e, 'Get issue readiness failed');
  }
}

export async function generateQuotePackHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithPerf;
    const policyId = policyIdFrom(req);
    const parsed = GenerateQuotePackBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new PublicApiError({
        httpStatus: 400,
        code: 'BAD_REQUEST',
        message: 'Invalid quote pack request payload',
      });
    }
    const docPack = String(parsed.data.docPack || 'QUOTE_PACK').toUpperCase();
    if (docPack !== 'QUOTE_PACK') {
      throw new PublicApiError({
        httpStatus: 400,
        code: 'BAD_REQUEST',
        message: 'Only QUOTE_PACK is supported on public endpoint',
      });
    }

    const resolved = await resolvePublicAutoPolicyLight(policyId, { perf: request.perf });
    const policy = resolved.policy;
    if (!policy) throw new PublicApiError({ httpStatus: 404, code: 'NOT_FOUND', message: 'Session not found' });
    if (!enforcePublicToken(request, resolved.mode, res)) return;

    const pack = await DocumentService.generate({
      policyId: policy.id,
      riskTransactionId: null,
      docPack: 'QUOTE_PACK',
      source: 'CUSTOMER',
      generatedByUserId: null,
    });
    const documentsRaw = Array.isArray(pack.documents) ? pack.documents : [];
    const documents = documentsRaw.map((d) => {
      const r = asRecord(d);
      const id = String(r.id || '').trim();
      return {
        ...r,
        publicUrl: id ? `/api/public/documents/${id}` : undefined,
      };
    });
    return res.json({
      success: true,
      data: {
        status: 'GENERATED',
        documents,
      },
    });
  } catch (e) {
    return sendPublicError(res, e, 'Generate quote pack failed');
  }
}

export async function issuedPackHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithPerf;
    const policyId = policyIdFrom(req);
    const resolved = await resolvePublicAutoPolicyLight(policyId, { perf: request.perf });
    const policy = resolved.policy;
    if (!policy) throw new PublicApiError({ httpStatus: 404, code: 'NOT_FOUND', message: 'Session not found' });
    if (!enforcePublicToken(request, resolved.mode, res)) return;

    // Must be paid to expose issued documents publicly.
    if (String(policy.paymentStatus || '').toUpperCase() !== 'PAID') {
      throw new PublicApiError({
        httpStatus: 422,
        code: 'NOT_PAID',
        message: 'Policy documents are available after payment is confirmed.',
      });
    }

    const riskTxn = await tenantScopedPrisma.riskTransaction.findFirst({
      where: { policyId: policy.id, transactionType: 'INCEPTION', status: 'BOUND' },
      orderBy: { transactionNumber: 'desc' },
      select: { id: true },
    });
    const riskTransactionId = riskTxn?.id || null;

    const result = await getOrQueuePublicIssuedPackLinks({ policyId: policy.id, riskTransactionId });
    if (result.queued) {
      return res.status(202).json({
        success: true,
        data: {
          status: 'PENDING',
          message: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
          missingTypes: result.missingTypes,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        publicExpiresAt: result.publicExpiresAt,
        documents: result.documents,
      },
    });
  } catch (e) {
    return sendPublicError(res, e, 'Issued pack failed');
  }
}

export async function unlockHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithPerf;
    const policyId = policyIdFrom(req);
    const resolved = await resolvePublicAutoPolicyFull(policyId, { perf: request.perf });
    const policy = resolved.policy;
    if (!policy) throw new PublicApiError({ httpStatus: 404, code: 'NOT_FOUND', message: 'Session not found' });
    if (!enforcePublicToken(request, resolved.mode, res)) return;

    const result = await unlockPublicAutoPolicy({ policy });
    if (policy.publicSessionToken) {
      await invalidateCachedLightByToken(String(policy.publicSessionToken), request.perf);
    }
    if (result.alreadyUnlocked) return res.json({ success: true, message: 'Policy is already unlocked' });
    return res.json({ success: true });
  } catch (e) {
    return sendPublicError(res, e, 'Unlock failed');
  }
}

export async function forkHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithPerf;
    const policyId = policyIdFrom(req);
    const resolved = await resolvePublicAutoPolicyFull(policyId, { perf: request.perf });
    const policy = resolved.policy;
    if (!policy) throw new PublicApiError({ httpStatus: 404, code: 'NOT_FOUND', message: 'Session not found' });
    if (!enforcePublicToken(request, resolved.mode, res)) return;

    const data = await forkPublicAutoPolicy({ originalPublicId: String(policyId || ''), policy });
    return res.json({ success: true, data });
  } catch (e) {
    return sendPublicError(res, e, 'Fork failed');
  }
}

export async function patchSessionHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithPerf;
    const correlationId = resolveCorrelationId(req);
    res.setHeader('x-correlation-id', correlationId);
    const policyId = policyIdFrom(req);
    const parsed = PatchSessionBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid request body', details: parsed.error.flatten() },
      });
    }
    const { quoteData, step, materializeAccount, origin, customerAccountResolution } = parsed.data;
    const resolution = customerAccountResolution?.action === 'createNew'
      ? { action: 'createNew' as const }
      : customerAccountResolution?.policyHolderId
        ? { action: 'attachExisting' as const, policyHolderId: customerAccountResolution.policyHolderId }
        : undefined;

    const resolved = await resolvePublicAutoPolicyLight(policyId, { perf: request.perf });
    if (!resolved.policy) throw new PublicApiError({ httpStatus: 404, code: 'NOT_FOUND', message: 'Session not found' });
    if (!enforcePublicToken(request, resolved.mode, res)) return;

    const data = await updatePublicAutoDraft({
      policyId: resolved.policy.id,
      quoteData,
      step,
      origin,
      materializeAccount: Boolean(materializeAccount),
      customerAccountResolution: resolution,
      correlationId,
    });
    if (resolved.policy.publicSessionToken) {
      await invalidateCachedLightByToken(String(resolved.policy.publicSessionToken), request.perf);
    }
    return res.json({ success: true, data });
  } catch (e) {
    return sendPublicError(res, e, 'Patch session failed');
  }
}

export async function rateHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithPerf;
    const correlationId = resolveCorrelationId(req);
    res.setHeader('x-correlation-id', correlationId);
    const policyId = policyIdFrom(req);
    const parsed = RateSessionBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid request body', details: parsed.error.flatten() },
      });
    }
    const { quoteData, overrideExcess, previewOnly, coverageSelection } = parsed.data;
    const resolved = await resolvePublicAutoPolicyLight(policyId, { perf: request.perf });
    if (!resolved.policy) throw new PublicApiError({ httpStatus: 404, code: 'NOT_FOUND', message: 'Session not found' });
    if (!enforcePublicToken(request, resolved.mode, res)) return;

    const data = await rateQuote({
      policyId: resolved.policy.id,
      quoteData,
      overrideExcess,
      previewOnly,
      coverageSelection,
      correlationId,
    });
    if (resolved.policy.publicSessionToken) {
      await invalidateCachedLightByToken(String(resolved.policy.publicSessionToken), request.perf);
    }
    return res.json({ success: true, data });
  } catch (e) {
    return sendPublicError(res, e, 'Rate failed');
  }
}
