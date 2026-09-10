import type { Prisma } from '@prisma/client';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { deepMergeQuoteData } from '../../../shared/lib/deepMerge.js';
import { Router, type Request, type Response } from 'express';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import {
  getProductSegmentLabel,
  productAdapterExists,
  resolvePolicyPeriodForProduct,
} from '../../policy/app/productRegistryService.js';
import { evaluateIssueReadiness } from '../../policy/app/issueReadiness.js';
import { transitionPolicyLifecycle } from '../../policy/app/commands/policyLifecycleCommands.js';
import { attemptIssuanceHealForPolicy } from '../../payments/app/cardcorpIssuanceHealService.js';
import {
  assertBinderAuthorizesProduct,
  BinderAuthorityError,
  findLatestActiveBinderLinkForProduct,
} from '../../policy/app/binders/binderAuthority.js';
import {
  hasCompleteCustomerContact,
  materializeCustomerAccountForPolicy,
  type CustomerAccountResolution,
} from '../../policy/app/customerAccountMaterialization.js';
import { enqueuePolicyListIndexUpdate } from '../../policy/app/policyListIndex.js';
import { rebuildAccountProjectionsNow } from '../../accounts360/app/accountProjectionRefresh.js';
import { logger } from '../../../platform/utils/logger.js';
import { patchDiff } from '../../../platform/utils/patchDiff.js';
import { generateQuoteId } from '../../../platform/utils/platformIds.js';
import { resolvePublicAppBaseUrlFromRequest } from '../../../platform/http/publicAppLinks.js';
import { sendQuoteResumeLinkForSession } from '../app/quoteResumeLinkService.js';
import { queuePublicQuoteEmailForSession } from '../app/publicQuoteEmailService.js';
import { ratePolicyAndPersist } from '../app/quoteRateService.js';
import { optionalAuthenticate } from '../../../platform/http/middleware/auth.js';
import { productChannelGateMiddleware } from '../../policy/http/productChannelGate.js';
import { randomBytes } from 'node:crypto';
import {
  createSessionHandler as createMotorSessionHandler,
  forkHandler as forkMotorSessionHandler,
  generateQuotePackHandler as generateMotorQuotePackHandler,
  getRecommendationsHandler as getMotorRecommendationsHandler,
  getIssueReadinessHandler as getMotorIssueReadinessHandler,
  getSessionHandler as getMotorSessionHandler,
  issuedPackHandler as issuedMotorPackHandler,
  patchSessionHandler as patchMotorSessionHandler,
  rateHandler as rateMotorSessionHandler,
  recoEventHandler as motorRecoEventHandler,
  requestCallbackHandler as requestMotorCallbackHandler,
  sendQuoteEmailHandler as sendMotorQuoteEmailHandler,
  unlockHandler as unlockMotorSessionHandler,
} from './publicAutoQuoteHandlers.js';

/**
 * Generic public quote session router factory.
 *
 * Builds a router mountable at `/public/:productCode/session` that:
 *   - POST /             -> creates a new draft policy + returns `publicSessionToken`
 *   - GET /:token        -> loads the session (quoteData, quoteResponse)
 *   - PATCH /:token      -> merges patch into session quoteData
 *   - POST /:token/rate  -> runs adapter.buildQuoteResponse + saves
 *   - POST /:token/issue -> transitions to ISSUING (creates riskTransaction)
 *   - POST /:token/fork  -> forks the session to a fresh token
 *
 * Uses the policy's `publicSessionToken` column (already present from motor flow)
 * as the lookup key. For non-motor products we generate a fresh token and keep
 * `policy.productType` set from creation.
 */

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * ABY-253 — draft policy numbers MUST use the canonical platform sequence
 * generator (`generateQuoteId()` → e.g. `ABQ1000083`).
 *
 * Previously this file carried a `newDraftPolicyNumber()` helper that built
 * an opaque `Q-${Date.now()}-${hex}` string. The original rationale was to
 * avoid a race on the `(policyNumber, renewalSequence)` unique index for
 * concurrent session creates — but the canonical `reserveNextQuoteId` /
 * `generateQuoteId` chain in `backend/platform/utils/platformIds.ts` is
 * already concurrency-safe (it uses `policyNumberSequence.upsert` with
 * `{ next: { increment: 1 } }`, which is atomic at the DB level). The
 * collision concern was real, the home-grown solution was wrong: the BO
 * `mutationsRouter.ts` path has always used the canonical generator and
 * has never collided.
 *
 * Surfacing `Q-1726...` to the customer-facing BO header (the "looks like
 * a database record" complaint in ABY-253) broke the documented business
 * format every other surface, document template, and reporting pipeline
 * expects — ABQ for draft quotes, ABOLV after issuance.
 *
 * Do NOT reintroduce a local timestamp+hex generator here.
 */

function parseCustomerAccountResolution(value: unknown): CustomerAccountResolution | null {
  const record = parseRecord(value);
  const action = String(record.action || '').trim();
  if (action === 'createNew') return { action };
  if (action === 'attachExisting') {
    const policyHolderId = String(record.policyHolderId || '').trim();
    return policyHolderId ? { action, policyHolderId } : null;
  }
  return null;
}

export function shouldMaterializeCustomerAccountForSession(args: {
  quoteData: unknown;
  requestedMaterialize: boolean;
  step: string;
}): boolean {
  const hasCompleteContact = hasCompleteCustomerContact(args.quoteData);
  return hasCompleteContact && (args.requestedMaterialize || args.step !== 'policy-holder');
}

export function createGenericPublicQuoteRouter(productCode: string): Router {
  const router = Router();
  const upperProduct = productCode.toUpperCase();

  // ADR-0046 — populate `req.user` when a BO Bearer token is present so the
  // product channel gates can let a logged-in admin bypass an OFF switch.
  router.use(optionalAuthenticate);

  // ABY-259 — gentle "email me a link to resume my quote" endpoint.
  //
  // Registered BEFORE the motor early-return so all three customer wizards
  // (travel, motor, home) hit the same handler. The route path uses `:token`
  // which doesn't collide with motor's `:policyId/*` routes — Express
  // matches by literal segment.
  //
  // Lookup is by `publicSessionToken` which is the same opaque slug the
  // wizard URL exposes (`/quote/<token>`) for every product. The token has
  // no TTL by design (`schema.prisma:478`), so the link in the email stays
  // valid until the policy is bound or deleted.
  //
  // No PDF, no OTP — that's the "no noise" half of the spec. The customer
  // gave us this email a few seconds ago by typing it into the wizard.
  router.post('/:token/resume-link', async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const body = parseRecord(req.body);
      const step = String(body.step || '').trim();
      const result = await sendQuoteResumeLinkForSession({
        productCode: upperProduct,
        publicSessionToken: token,
        step,
        baseUrl: resolvePublicAppBaseUrlFromRequest(req),
      });
      if (!result.ok) {
        return res.status(result.status).json({
          success: false,
          error: { code: result.code, message: result.message },
        });
      }
      logger.info({
        event: 'quote.resume_link.requested',
        product: upperProduct,
        step: step || null,
        toEmail: result.toEmail,
        queued: result.sent,
      }, 'quote.resume_link.requested');
      return res.json({
        success: true,
        data: { sent: result.sent, toEmail: result.toEmail },
      });
    } catch (error) {
      logger.error({ err: error, productCode }, 'public session resume-link failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to send resume link' } });
    }
  });

  if (upperProduct === 'MOTOR') {
    // ADR-0046 — gate questions (session create) and quote (rate). Other motor
    // routes operate on an already-created session and are not new entry points.
    router.post('/', productChannelGateMiddleware('MOTOR', 'questions'), createMotorSessionHandler);
    router.get('/:policyId', getMotorSessionHandler);
    router.get('/:policyId/issue-readiness', getMotorIssueReadinessHandler);
    router.get('/:policyId/recommendations', getMotorRecommendationsHandler);
    router.post('/:policyId/recommendations/events', motorRecoEventHandler);
    router.post('/:policyId/documents/generate', generateMotorQuotePackHandler);
    router.post('/:policyId/documents/issued-pack', issuedMotorPackHandler);
    router.post('/:policyId/unlock', unlockMotorSessionHandler);
    router.post('/:policyId/fork', forkMotorSessionHandler);
    router.post('/:policyId/request-callback', requestMotorCallbackHandler);
    router.post('/:policyId/quote/send', sendMotorQuoteEmailHandler);
    router.patch('/:policyId', patchMotorSessionHandler);
    router.post('/:policyId/rate', productChannelGateMiddleware('MOTOR', 'quote'), rateMotorSessionHandler);
    return router;
  }

  router.post('/', productChannelGateMiddleware(upperProduct, 'questions'), async (req: Request, res: Response) => {
    try {
      if (!productAdapterExists(upperProduct)) return res.status(500).json({ success: false, error: { message: `No adapter for ${upperProduct}` } });
      const body = parseRecord(req.body);
      const initialQuoteData = parseRecord(body.quoteData) as Prisma.InputJsonObject;
      const hasInitialQuoteData = Object.keys(initialQuoteData).length > 0;

      const inceptionDate = new Date();
      const binderLink = await findLatestActiveBinderLinkForProduct({
        productCode: upperProduct,
        inceptionDate,
      });
      if (!binderLink) {
        return res.status(503).json({ success: false, error: { message: `No active binder linked for ${upperProduct} in this tenant` } });
      }
      const program = binderLink.program;

      // Lloyd's-grade: refuse to seed a session if the binder doesn't authorize this product.
      try {
        await assertBinderAuthorizesProduct({ binderId: binderLink.binderId, productCode: upperProduct });
      } catch (authErr) {
        if (authErr instanceof BinderAuthorityError) {
          return res.status(422).json({
            success: false,
            error: { code: authErr.code, message: authErr.message, reason: authErr.reason },
          });
        }
        throw authErr;
      }

      const token = newToken();
      const placeholderData: WithoutTenantScope<Prisma.PolicyHolderUncheckedCreateInput> = {
        name: 'Quote in progress',
        segment: getProductSegmentLabel(upperProduct),
        address: '',
      };
      const placeholder = await tenantScopedPrisma.policyHolder.create({
        data: placeholderData as Prisma.PolicyHolderUncheckedCreateInput,
      });
      const policyData: WithoutTenantScope<Prisma.PolicyUncheckedCreateInput> = {
        policyNumber: await generateQuoteId(upperProduct),
        status: 'INTAKE',
        productType: upperProduct,
        policyHolderId: placeholder.id,
        programId: program.id,
        binderId: binderLink.binderId,
        inceptionDate,
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        publicSessionToken: token,
        ...(hasInitialQuoteData ? { quoteData: initialQuoteData } : {}),
      };
      const policy = await tenantScopedPrisma.policy.create({
        data: policyData as Prisma.PolicyUncheckedCreateInput,
      });
      const snapshot: Prisma.InputJsonObject = {
        quoteData: initialQuoteData,
        source: 'public_session_create',
      };
      const stateCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
        policyId: policy.id,
        snapshot,
      };
      await tenantScopedPrisma.policyStateCurrent.create({
        data: stateCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
      });

      return res.json({
        success: true,
        data: { publicSessionToken: token, policyId: policy.id },
      });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      logger.error({ err: error, productCode, code: err?.code }, 'public session create failed');
      return res.status(500).json({
        success: false,
        error: {
          code: err?.code || 'SESSION_CREATE_FAILED',
          message: err?.message || 'Failed to create session',
        },
      });
    }
  });

  router.get('/:token', async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const policy = await tenantScopedPrisma.policy.findFirst({ where: { publicSessionToken: token, productType: upperProduct } });
      if (!policy) return res.status(404).json({ success: false, error: { message: 'Session not found' } });
      const state = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: policy.id } });
      const snapshot = parseRecord(state?.snapshot);
      const quoteData = Object.prototype.hasOwnProperty.call(snapshot, 'quoteData')
        ? snapshot.quoteData
        : parseRecord(policy.quoteData);
      const quoteResponse = Object.prototype.hasOwnProperty.call(snapshot, 'quoteResponse')
        ? snapshot.quoteResponse
        : undefined;
      // ABY-42: surface the customer-facing `policyNumber` (e.g.
      // ABOLV-XXXX / ABQ-XXXX) and a derived `issued` flag so the
      // post-payment "thank you" page can show a real, BO-searchable
      // reference instead of the opaque `publicSessionToken` and can
      // gate "your documents have been emailed" copy on actual
      // issuance rather than payment alone.
      const statusUpper = String(policy.status || '').toUpperCase();
      const issued = ['BOUND', 'ISSUED', 'ACTIVE'].includes(statusUpper);
      return res.json({
        success: true,
        data: {
          policyId: policy.id,
          policyNumber: policy.policyNumber || null,
          quoteData,
          quoteResponse,
          status: policy.status,
          issued,
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'public session get failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to load session' } });
    }
  });

  router.patch('/:token', async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const body = parseRecord(req.body);
      const patch = parseRecord(body.quoteData);
      const policy = await tenantScopedPrisma.policy.findFirst({ where: { publicSessionToken: token, productType: upperProduct } });
      if (!policy) return res.status(404).json({ success: false, error: { message: 'Session not found' } });

      const state = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: policy.id } });
      const prev = parseRecord(state?.snapshot);
      // ABY-414 — keep filled proposer leaves when a later wizard autosave
      // sends empty strings from defaultValues. Same empty-leaf merge as
      // ABY-256 BO GET: policy column, then snapshot, then this patch.
      const mergedQuoteData = deepMergeQuoteData(
        deepMergeQuoteData(policy.quoteData, prev.quoteData),
        patch,
      );
      const policyPeriod = resolvePolicyPeriodForProduct(upperProduct, mergedQuoteData);
      const effectiveBinderLink = policyPeriod
        ? await findLatestActiveBinderLinkForProduct({
          productCode: upperProduct,
          inceptionDate: policyPeriod.inceptionDate,
        })
        : null;
      const origin = String(body.origin || '').trim() === 'bo' ? 'bo' : 'customer';
      const step = String(body.step || '').trim();
      const shouldMaterializeAccount = shouldMaterializeCustomerAccountForSession({
        quoteData: mergedQuoteData,
        requestedMaterialize: Boolean(body.materializeAccount),
        step,
      });
      const resolution = parseCustomerAccountResolution(body.customerAccountResolution);
      const nextSnapshot = { ...prev, quoteData: mergedQuoteData };

      let materializedPolicyHolderId: string | null = null;
      await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as Prisma.TransactionClient;
        if (shouldMaterializeAccount) {
          const materialized = await materializeCustomerAccountForPolicy({
            tx,
            policyId: policy.id,
            currentPolicyHolderId: policy.policyHolderId,
            quoteData: mergedQuoteData,
            segment: getProductSegmentLabel(upperProduct),
            conflictMode: origin === 'bo' ? 'requireResolution' : 'autoAttach',
            resolution,
          });
          if (materialized.status === 'conflict') {
            throw Object.assign(new Error('A customer account already exists with this email or NIF.'), {
              httpStatus: 409,
              code: 'CUSTOMER_ACCOUNT_CONFLICT',
              details: { matches: materialized.matches },
            });
          }
          materializedPolicyHolderId = materialized.policyHolder.id;
          const policySearchCreate: Prisma.PolicySearchIndexUncheckedCreateInput = {
            policyId: policy.id,
            operatingTenantId: policy.operatingTenantId,
            policyNumber: policy.policyNumber,
            insuredName: materialized.policyHolder.name,
            status: policy.status,
            segment: getProductSegmentLabel(upperProduct),
            address: materialized.policyHolder.address || '',
          };
          await tx.policySearchIndex.upsert({
            where: { policyId: policy.id },
            update: {
              insuredName: materialized.policyHolder.name,
              address: materialized.policyHolder.address || '',
              segment: getProductSegmentLabel(upperProduct),
            },
            create: policySearchCreate,
          });
        }
        await tx.policy.update({
          where: { id: policy.id },
          data: {
            quoteData: mergedQuoteData as never,
            ...(policyPeriod ? {
              inceptionDate: policyPeriod.inceptionDate,
              expiryDate: policyPeriod.expiryDate,
            } : {}),
            ...(effectiveBinderLink?.binderId ? { binderId: effectiveBinderLink.binderId } : {}),
            ...(effectiveBinderLink?.programId ? { programId: effectiveBinderLink.programId } : {}),
          },
        });
        await enqueuePolicyListIndexUpdate(tx, policy.id);
        const patchStateCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
          policyId: policy.id,
          snapshot: nextSnapshot as never,
        };
        await tx.policyStateCurrent.upsert({
          where: { policyId: policy.id },
          update: { snapshot: nextSnapshot as never },
          create: patchStateCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });
      });
      if (materializedPolicyHolderId) {
        await rebuildAccountProjectionsNow(materializedPolicyHolderId);
      }
      const prevQuoteData = parseRecord(parseRecord(state?.snapshot).quoteData);
      const diffResult = patchDiff(prevQuoteData, mergedQuoteData as Record<string, unknown>);
      if (diffResult.addedKeys.length > 0 || diffResult.changedKeys.length > 0 || diffResult.removedKeys.length > 0) {
        logger.info({
          event: 'quote.patch.applied',
          policyId: policy.id,
          product: upperProduct,
          step: step || null,
          diff: diffResult,
        }, 'quote.patch.applied');
      }
      return res.json({
        success: true,
        data: {
          policyId: policy.id,
          quoteData: mergedQuoteData,
          policyHolderId: materializedPolicyHolderId || policy.policyHolderId,
        },
      });
    } catch (error) {
      const err = error as { httpStatus?: number; code?: string; message?: string; details?: unknown };
      if (err.httpStatus && err.code) {
        return res.status(err.httpStatus).json({
          success: false,
          error: { code: err.code, message: err.message || 'Failed to save session', details: err.details },
        });
      }
      logger.error({ err: error }, 'public session patch failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to save session' } });
    }
  });

  router.post('/:token/quote/send', async (
    req: Request<{ token: string }>,
    res: Response,
  ) => {
    try {
      const { token } = req.params;
      const result = await queuePublicQuoteEmailForSession({
        productCode: upperProduct,
        publicSessionToken: token,
        baseUrl: resolvePublicAppBaseUrlFromRequest(req),
        source: 'manual',
        correlationId: req.correlationId,
      });
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404
          : result.code === 'MISSING_EMAIL' ? 422
            : result.code === 'NOT_QUOTED' ? 422
              : result.code === 'PDF_FAILED' ? 500
                : 502;
        return res.status(status).json({
          success: false,
          error: { code: result.code, message: result.message },
        });
      }
      return res.json({
        success: true,
        data: {
          status: 'queued',
          recipient: result.recipient,
        },
      });
    } catch (error) {
      logger.error({ err: error, productCode }, 'public session quote/send failed');
      return res.status(500).json({ success: false, error: { message: 'Quote send failed' } });
    }
  });

  router.post('/:token/rate', productChannelGateMiddleware(upperProduct, 'quote'), async (req: Request, res: Response) => {
    try {
      const { token } = req.params;

      const policy = await tenantScopedPrisma.policy.findFirst({ where: { publicSessionToken: token, productType: upperProduct } });
      if (!policy) return res.status(404).json({ success: false, error: { message: 'Session not found' } });

      // ABY-261 — funnel through the canonical app-layer rate spine
      // (`backend/modules/quotes/app/quoteRateService.ts`). The CardCorp
      // checkout boundary calls the same function, so the wizard,
      // documents, BO header and the actual charged amount can never
      // diverge again. Per-rule guard: `check-backend-layer-imports.mjs`.
      const result = await ratePolicyAndPersist({
        policyId: policy.id,
        productType: upperProduct,
        correlationId: req.correlationId,
        ...(upperProduct === 'HOME' ? { quoteEmailIntent: 'SEND_AFTER_QUOTED' as const } : {}),
      });
      if (!result.ok) {
        const correlationId = req.correlationId;
        return res.status(result.status).json({
          success: false,
          error: {
            code: result.code,
            message: result.message,
            details: { ...(result.details || {}), correlationId },
          },
        });
      }
      return res.json({ success: true, data: result.quoteResponse });
    } catch (error) {
      // Calculator validation errors (INVALID_DOB, INVALID_TRIP_DATES,
      // MISSING_MAX_TRIP_DAYS) are data-quality failures, not server faults.
      // Return 422 so the frontend can surface a meaningful message rather
      // than treating them as opaque 500s.
      const e = error as { name?: string; code?: string; message?: string };
      if (e?.name === 'TravelQuoteValidationError' && e?.code) {
        logger.warn({ err: error, productCode, code: e.code }, 'public session rate: calculator validation error');
        return res.status(422).json({ success: false, error: { code: e.code, message: e.message || 'Quote data is not valid for rating' } });
      }
      logger.error({ err: error, productCode }, 'public session rate failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to calculate quote' } });
    }
  });

  router.post('/:token/issue', async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const policy = await tenantScopedPrisma.policy.findFirst({ where: { publicSessionToken: token, productType: upperProduct } });
      if (!policy) return res.status(404).json({ success: false, error: { message: 'Session not found' } });

      // Canonical funnel: evaluate readiness as the customer would see it. Payment is the only
      // blocker we expect at this hand-off (the wizard has not collected payment yet); any other
      // BLOCK-severity blocker means the wizard routed the customer here too early and we refuse.
      const readiness = await evaluateIssueReadiness(policy.id, 'customer');
      const nonPaymentBlocks = (readiness.blockers || []).filter(
        (b) => (b.severity ?? 'BLOCK') === 'BLOCK' && (b.group || 'OTHER') !== 'PAYMENT' && b.code !== 'POLICY_LOCKED_BY_TRANSACTION',
      );
      if (nonPaymentBlocks.length > 0) {
        return res.status(422).json({
          success: false,
          error: { code: 'NOT_READY_FOR_PAYMENT', message: 'Quote is not ready to take payment.', blockers: nonPaymentBlocks },
        });
      }

      await tenantScopedPrisma.$transaction(async (tx) => {
        await transitionPolicyLifecycle({
          tx: tx as Prisma.TransactionClient,
          policyId: policy.id,
          to: 'AWAITING_PAYMENT',
          actorId: 'public-session',
          actorType: 'CUSTOMER',
          reasonCode: 'PUBLIC_SESSION_PAYMENT_HANDOFF',
          correlationId: req.correlationId,
        });
      });
      return res.json({ success: true, data: { policyId: policy.id, readiness } });
    } catch (error) {
      logger.error({ err: error, productCode }, 'public session issue failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to issue policy' } });
    }
  });

  router.post('/:token/fork', async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const original = await tenantScopedPrisma.policy.findFirst({ where: { publicSessionToken: token, productType: upperProduct } });
      if (!original) return res.status(404).json({ success: false, error: { message: 'Session not found' } });
      const newTok = newToken();
      const state = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: original.id } });
      const forkHolderData: WithoutTenantScope<Prisma.PolicyHolderUncheckedCreateInput> = {
        name: 'Quote in progress',
        segment: original.productType || upperProduct,
        address: '',
      };
      const holder = await tenantScopedPrisma.policyHolder.create({
        data: forkHolderData as Prisma.PolicyHolderUncheckedCreateInput,
      });
      if (original.binderId) {
        try {
          await assertBinderAuthorizesProduct({ binderId: original.binderId, productCode: upperProduct });
        } catch (authErr) {
          if (authErr instanceof BinderAuthorityError) {
            return res.status(422).json({
              success: false,
              error: { code: authErr.code, message: authErr.message, reason: authErr.reason },
            });
          }
          throw authErr;
        }
      }
      const forkPolicyData: WithoutTenantScope<Prisma.PolicyUncheckedCreateInput> = {
        policyNumber: await generateQuoteId(upperProduct),
        status: 'INTAKE',
        productType: upperProduct,
        policyHolderId: holder.id,
        programId: original.programId || undefined,
        binderId: original.binderId || undefined,
        inceptionDate: original.inceptionDate,
        expiryDate: original.expiryDate,
        publicSessionToken: newTok,
        quoteData: (state?.snapshot as Record<string, unknown> | null | undefined)?.quoteData as never,
      };
      const next = await tenantScopedPrisma.policy.create({
        data: forkPolicyData as Prisma.PolicyUncheckedCreateInput,
      });
      return res.json({ success: true, data: { publicSessionToken: newTok, policyId: next.id } });
    } catch (error) {
      logger.error({ err: error }, 'public session fork failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to fork session' } });
    }
  });

  router.get('/:token/issue-readiness', async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      if (!productAdapterExists(upperProduct)) return res.status(500).json({ success: false, error: { message: `No adapter for ${upperProduct}` } });

      const policy = await tenantScopedPrisma.policy.findFirst({ where: { publicSessionToken: token, productType: upperProduct } });
      if (!policy) return res.status(404).json({ success: false, error: { message: 'Session not found' } });

      // ABY-70 — durable self-heal for the "PAID-but-no-INCEPTION"
      // zombie. See full rationale in
      // `backend/modules/payments/app/cardcorpIssuanceHealService.ts`
      // and the mirrored call in
      // `backend/products/motor/quotes/controller.ts.getIssueReadinessHandler`.
      // Mounted on the SAME route the wizard's `pending_issuance` UI
      // polls (`/api/public/<product>/session/:token/issue-readiness`),
      // so home / travel / health all inherit the same recovery
      // path as motor without a parallel spine.
      await attemptIssuanceHealForPolicy({
        policy: { id: policy.id, policyNumber: policy.policyNumber, productType: policy.productType },
        correlationId: req.correlationId,
      });

      const readiness = await evaluateIssueReadiness(policy.id, 'customer');
      return res.json({ success: true, data: readiness });
    } catch (error) {
      logger.error({ err: error }, 'public session issue-readiness failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to check readiness' } });
    }
  });

  return router;
}
