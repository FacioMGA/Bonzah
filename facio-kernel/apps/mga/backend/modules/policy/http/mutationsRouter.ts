import type { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response, Router } from 'express';
import { prisma, tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import type { ApiResponse } from '../../../platform/types/index.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { jsonStringify, newPublicSessionToken } from '../app/shared.js';
import { reserveNextQuoteId } from '../../../platform/utils/platformIds.js';
import { enqueuePolicyListIndexUpdate } from '../app/policyListIndex.js';
import { z } from 'zod';
import { assertBinderAuthorizesProduct, BinderAuthorityError, findLatestActiveBinderLinkForProduct } from '../app/binders/binderAuthority.js';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { rateQuoteUseCase } from '../app/quoteLifecycle/rateQuoteUseCase.js';
import { evaluateIssueReadiness } from '../app/issueReadiness.js';

import { resolveProductAvailability } from '../../jurisdiction/app/productAvailability.js';
import { logger } from '../../../platform/utils/logger.js';
type ErrorBody = ApiResponse<null>;

function sendError(res: Pick<Response, 'status' | 'json'>, status: number, code: string, message: string) {
  const payload: ErrorBody = {
    success: false,
    error: { code, message },
  };
  return res.status(status).json(payload);
}

const ProgramBinderBodySchema = z.object({
  programId: z.string().trim().min(1),
  binderId: z.string().trim().min(1),
});

const CreatePolicyBodySchema = z.object({
  name: z.string().trim().optional(),
  contact: z.record(z.string(), z.unknown()).optional(),
  productType: z.string().trim().min(1).transform((value) => value.toUpperCase()),
});

const JsonRecordSchema = z.record(z.string(), z.unknown());

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function actorFromRequest(req: { user?: Express.UserTokenPayload }): {
  id: string | null;
  role: string | null;
  name: string | null;
  email: string | null;
} {
  const user = req.user;
  const id = user && typeof user.id === 'string' ? user.id : null;
  const role = user && typeof user.role === 'string' ? user.role : null;
  const name = user && typeof user.name === 'string' ? user.name : null;
  const email = user && typeof user.email === 'string' ? user.email : null;
  return { id, role, name, email };
}

function parseSnapshotRecord(value: unknown): Record<string, unknown> {
  const parsed = JsonRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
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
 * Policy mutation routes (create/update).
 */
export function registerPolicyMutationRoutes(router: Router) {
  /**
   * POST /api/policies/:id/public-session-token
   * Internal-only helper: returns (and self-heals) the public session token for customer quote links.
   */
  router.post('/:id/public-session-token', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id },
        select: { id: true, publicSessionToken: true, productType: true },
      });

      if (!policy) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      }

      // Only meaningful for the customer quote wizard right now.
      if (!policy.productType) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Policy has no product type' } });
      }

      let token = policy.publicSessionToken;
      if (!token) {
        token = newPublicSessionToken();
        await tenantScopedPrisma.policy.update({ where: { id: policy.id }, data: { publicSessionToken: token } });
      }

      return res.json({ success: true, data: { publicSessionToken: token, productType: policy.productType } });
    } catch (error) {
      logger.error({ err: error }, 'Public session token error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to get public session token') } });
    }
  });

  /**
   * PUT /api/policies/:id/program-binder
   * Assign a Program + Binder to a policy (1:1 at runtime).
   * Enforces that the (programId, binderId) pair is allowed via ProgramBinderLink and binder is ACTIVE.
   */
  router.put('/:id/program-binder', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const parsedBody = ProgramBinderBodySchema.safeParse(req.body || {});
      if (!parsedBody.success) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'programId and binderId are required' },
          details: parsedBody.error.flatten(),
        });
      }
      const { programId, binderId } = parsedBody.data;

      const [policy, program, binder] = await Promise.all([
        tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { id: true, status: true, isLocked: true } }),
        tenantScopedPrisma.program.findUnique({ where: { id: String(programId) }, select: { id: true, status: true, name: true, productType: true } }),
        tenantScopedPrisma.binder.findUnique({ where: { id: String(binderId) }, select: { id: true, status: true, agreementNumber: true, umr: true, startDate: true, endDate: true } }),
      ]);

      if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      if (policy.isLocked) {
        return res.status(423).json({ success: false, error: { code: 'POLICY_LOCKED', message: 'Policy is locked; cannot change program/binder.' } });
      }
      if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
      const resolvedProductType = String(program.productType || '').trim() || null;
      const availability = resolveProductAvailability(resolvedProductType || '');
      if (!availability.available) {
        return sendError(res, 403, 'PRODUCT_UNAVAILABLE', availability.message);
      }
      if (!binder) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Binder not found' } });

      const binderStatus = String(binder.status || '').toUpperCase();
      if (binderStatus !== 'ACTIVE') {
        return res.status(400).json({ success: false, error: { code: 'BINDER_NOT_ACTIVE', message: 'Binder must be ACTIVE to be assigned.' } });
      }

      const link = await prisma.programBinderLink.findFirst({
        where: { programId: String(programId), binderId: String(binderId), status: 'ACTIVE' },
        select: { id: true },
      });
      if (!link) {
        // Self-heal stale seed data: if this program is linked to a binder with the same agreement number,
        // create/activate the link for the selected ACTIVE binder id.
        const fallbackLink =
          binder.agreementNumber
            ? await prisma.programBinderLink.findFirst({
              where: {
                programId: String(programId),
                status: 'ACTIVE',
                binder: { agreementNumber: String(binder.agreementNumber) },
              },
              select: { id: true },
            })
            : null;
        if (fallbackLink) {
          await prisma.programBinderLink.upsert({
            where: {
              programId_binderId: { programId: String(programId), binderId: String(binderId) },
            },
            update: { status: 'ACTIVE' },
            create: { programId: String(programId), binderId: String(binderId), status: 'ACTIVE' },
          });
        }
      }
      const linkAfterHeal = await prisma.programBinderLink.findFirst({
        where: { programId: String(programId), binderId: String(binderId), status: 'ACTIVE' },
        select: { id: true },
      });
      if (!linkAfterHeal) {
        return res.status(422).json({
          success: false,
          error: { code: 'PROGRAM_BINDER_NOT_ALLOWED', message: 'This binder is not linked/allowed for the selected program.' }
        });
      }

      // Lloyd's-grade check (ADR-0019, strict by default): the binder must
      // explicitly authorize this product via a `BinderProductAuthority` row.
      // No synthetic / non-strict path — backfill the authority row before
      // retrying.
      if (resolvedProductType) {
        try {
          await assertBinderAuthorizesProduct({
            binderId: String(binderId),
            productCode: resolvedProductType,
          });
        } catch (err) {
          if (err instanceof BinderAuthorityError) {
            return res.status(422).json({
              success: false,
              error: { code: err.code, message: err.message, reason: err.reason },
            });
          }
          throw err;
        }
      }

      let wasQuestionnaireSuperseded = false;
      let supersededProductType = '';

      const updated = await runTenantScopedTransaction(async (_tx) => {
        const tx = _tx as Prisma.TransactionClient;
        const p = await tx.policy.update({
          where: { id: policyId },
          data: {
            programId: String(programId),
            binderId: String(binderId),
            ...(resolvedProductType ? { productType: resolvedProductType } : {}),
          },
          select: { id: true, programId: true, binderId: true, productType: true },
        });

        const state = await tx.policyStateCurrent.findUnique({ where: { policyId } });
        const prev = parseSnapshotRecord(state?.snapshot);
        const prevFlow = parseSnapshotRecord(prev.customerFlow);
        const prevUwState = String(prev.uwWorkflowState || '');

        // An active questionnaire exists when an invitation was sent for the previous
        // product, has not already been superseded, and the workflow is in a sent/live
        // state (including SUBMITTED so already-answered questionnaires are also covered).
        const hasActiveQuestionnaire =
          !!prevFlow.inviteSentAt &&
          !prevFlow.questionnaireSupersededAt &&
          ['QUESTIONNAIRE_SENT', 'FOLLOWUPS_OPEN', 'SUBMITTED'].includes(prevUwState);

        const supersededAt = new Date().toISOString();
        supersededProductType = String(prev.productType || '');

        const nextSnapshot: Record<string, unknown> = {
          ...prev,
          programId: String(programId),
          binderId: String(binderId),
          ...(resolvedProductType ? { productType: resolvedProductType } : {}),
          ...(hasActiveQuestionnaire ? {
            customerFlow: {
              ...prevFlow,
              questionnaireSupersededAt: supersededAt,
              supersededProductType: supersededProductType,
            },
          } : {}),
        };
        const nextSnapshotCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
          policyId,
          snapshot: jsonStringify(nextSnapshot),
        };
        await tx.policyStateCurrent.upsert({
          where: { policyId },
          update: { snapshot: jsonStringify(nextSnapshot) },
          create: nextSnapshotCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });

        if (hasActiveQuestionnaire) {
          wasQuestionnaireSuperseded = true;
          // Durable outbox event — atomic with snapshot write.
          // No BullMQ worker handler registered this sprint; row persists for future replay
          // (e.g. customer notification that their questionnaire link is no longer active).
          await appendDomainEvent(tx, buildDomainEvent({
            aggregateType: 'UW_WORKFLOW',
            aggregateId: policyId,
            aggregateVersion: Date.now(),
            eventType: 'UW.QUESTIONNAIRE_SUPERSEDED',
            actorType: 'USER',
            actorId: String((req as { user?: { id?: string } }).user?.id || 'unknown'),
            correlationId: req.correlationId,
            data: {
              supersededAt,
              supersededProductType: supersededProductType,
              newBinderId: String(binderId),
              newProgramId: String(programId),
              newProductType: resolvedProductType || null,
            },
          }));
        }

        return p;
      });

      // Best-effort audit — AuditLogger uses global prisma client, cannot join a transaction.
      const actor = actorFromRequest(req);
      await AuditLogger.log(
        policyId,
        'POLICY',
        'COVERAGE.UPDATED',
        actor.id || 'system',
        actor.role ? 'USER' : 'SYSTEM',
        { programId: String(programId), binderId: String(binderId), binderAgreementNumber: binder.agreementNumber, binderUmr: binder.umr, productType: resolvedProductType }
      );

      if (wasQuestionnaireSuperseded) {
        // Best-effort audit entry for questionnaire supersede — separate from COVERAGE.UPDATED
        // so the audit trail clearly shows the questionnaire lifecycle event.
        await AuditLogger.log(
          policyId,
          'POLICY',
          'QUESTIONNAIRE.SUPERSEDED',
          actor.id || 'system',
          actor.role ? 'USER' : 'SYSTEM',
          { supersededProductType, newBinderId: String(binderId), newProgramId: String(programId), newProductType: resolvedProductType || null }
        );
      }

      return res.json({ success: true, data: updated });
    } catch (error) {
      logger.error({ err: error }, 'Assign program/binder error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to assign program/binder') } });
    }
  });

  router.post('/', policyAuditLog, createPolicyHandler);

  /**
   * POST /api/policies/:id/manual-uw-approval
   * Marks the policy as manually approved by an underwriter (exception approval),
   * and persists approval metadata into policyStateCurrent.snapshot. The
   * canonical quote-rating spine then builds and persists the resulting
   * quoteResponse, pricing stamp, and lifecycle status together.
   */
  router.post('/:id/manual-uw-approval', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);

      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        select: { id: true, status: true, productType: true },
      });
      if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      if (!policy.productType) return res.status(409).json({ success: false, error: { code: 'PRODUCT_TYPE_MISSING', message: 'The policy has no product type for underwriting approval.' } });
      const policyStatus = String(policy.status || '').toUpperCase();
      const isStaleQuotedApproval = policyStatus === 'QUOTED'
        && (await evaluateIssueReadiness(policy.id, 'bo')).blockers
          .some((blocker) => blocker.code === 'MANUAL_UW_APPROVAL_STALE');
      if (policyStatus !== 'REFERRAL' && !isStaleQuotedApproval) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'MANUAL_UW_APPROVAL_STATUS_INVALID',
            message: 'Manual underwriting approval is only available for a referred policy or a stale approved quote.',
          },
        });
      }

      // Never hand-edit policy.quoteResponse or the lifecycle status here.
      // rateQuoteUseCase delegates to ratePolicyAndPersist, the canonical
      // quote-response persistence path. It refreshes the pricing-integrity
      // stamp along with the response and preserves a current approval only
      // while the adapter-approved customer completion fields are the sole
      // changes to the reviewed risk.
      const rerated = await rateQuoteUseCase({
        policyId,
        actor: {
          id: actor.id || 'system',
          role: actor.role === 'UNDERWRITER' ? 'UNDERWRITER' : actor.role === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
          ...(actor.name ? { name: actor.name } : {}),
        },
        correlationId: req.correlationId,
        manualUwApproval: {
          approvedBy: {
            id: actor.id,
            name: actor.name,
            email: actor.email,
            role: actor.role,
          },
          ...(isStaleQuotedApproval ? { reapprovalForStaleQuotedPolicy: true } : {}),
        },
      });
      if (!rerated.ok) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'UW_APPROVAL_RERATE_FAILED',
            message: rerated.message,
          },
        });
      }

      await AuditLogger.log(
        policyId,
        'POLICY',
        'POLICY.UW.MANUAL_APPROVAL',
        actor.id || 'system',
        actor.role ? 'USER' : 'SYSTEM',
        { fromStatus: policy.status, toStatus: rerated.status },
        actor.name || undefined
      );

      return res.json({ success: true, data: { id: policyId, status: rerated.status } });
    } catch (error) {
      logger.error({ err: error }, 'Manual UW approval error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to apply manual underwriter approval') } });
    }
  });
}

/**
 * POST /api/policies
 * Create a new policy (Draft + Inception Endorsement)
 *
 * Exported for direct use in tests and the composition root.
 */
export const createPolicyHandler = async (
  req: Pick<Request, 'body' | 'user'>,
  res: Pick<Response, 'setHeader' | 'status' | 'json'>
) => {
  try {
    // This endpoint creates a new policy session (same data model as the customer wizard).
    const actor = actorFromRequest(req);
    const parsedBody = CreatePolicyBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      const payload: ErrorBody & { details: ReturnType<typeof parsedBody.error.flatten> } = {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid policy payload' },
        details: parsedBody.error.flatten(),
      };
      return res.status(400).json(payload);
    }
    const requestedName = String(parsedBody.data.name || '').trim();
    const contact = parseSnapshotRecord(parsedBody.data.contact || {});
    const productType = parsedBody.data.productType;
    const availability = resolveProductAvailability(productType);
    if (!availability.available) {
      return sendError(res, 403, 'PRODUCT_UNAVAILABLE', availability.message);
    }

    const now = new Date();
    const expiry = new Date(now);
    expiry.setFullYear(expiry.getFullYear() + 1);

    const result = await runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
      const binderLink = await findLatestActiveBinderLinkForProduct({
        productCode: productType,
        inceptionDate: now,
        db: tx,
      });
      if (!binderLink) return null;
      let policyNumber: string;
      try {
        policyNumber = await reserveNextQuoteId(tx, productType);
      } catch (error) {
        if (process.env.KERNEL_PLATFORM_MODE === 'true') throw error;
        // Legacy test compatibility; shared platform always requires its durable counter.
        policyNumber = `ABB-${Date.now()}`;
      }
      const publicSessionToken = newPublicSessionToken();
      const initialQuoteData = { __meta: { origin: 'bo' } };

      const policyHolderData: WithoutTenantScope<Prisma.PolicyHolderUncheckedCreateInput> = {
        name: requestedName || 'New Submission',
        segment: null,
        address: '',
        contact: Object.keys(contact || {}).length > 0 ? JSON.stringify(contact) : undefined,
      };
      const policyHolder = await tx.policyHolder.create({
        data: policyHolderData as Prisma.PolicyHolderUncheckedCreateInput,
      });

      const policyData: WithoutTenantScope<Prisma.PolicyUncheckedCreateInput> = {
        policyNumber,
        publicSessionToken,
        productType,
        programId: binderLink.programId,
        binderId: binderLink.binderId,
        status: 'DRAFT',
        inceptionDate: now,
        expiryDate: expiry,
        policyHolderId: policyHolder.id,
        quoteData: initialQuoteData,
      };
      const policy = await tx.policy.create({
        data: policyData as Prisma.PolicyUncheckedCreateInput,
      });

      const initialStateCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
        policyId: policy.id,
        snapshot: {
          quoteData: initialQuoteData,
          productType,
          programId: binderLink.programId,
          binderId: binderLink.binderId,
          step: 'policy-holder',
          flow_context: { channel: 'bo', step: 'policy_holder' },
        },
      };
      await tx.policyStateCurrent.upsert({
        where: { policyId: policy.id },
        update: {
          snapshot: {
            quoteData: initialQuoteData,
            productType,
            programId: binderLink.programId,
            binderId: binderLink.binderId,
            step: 'policy-holder',
            flow_context: { channel: 'bo', step: 'policy_holder' },
          },
        },
        create: initialStateCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
      });

      const searchIndexCreate: WithoutTenantScope<Prisma.PolicySearchIndexUncheckedCreateInput> = {
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        insuredName: policyHolder.name,
        status: policy.status,
        segment: null,
        address: '',
      };
      await tx.policySearchIndex.upsert({
        where: { policyId: policy.id },
        update: { policyNumber: policy.policyNumber, insuredName: policyHolder.name, status: policy.status, segment: null, address: '' },
        create: searchIndexCreate as Prisma.PolicySearchIndexUncheckedCreateInput,
      });
      await enqueuePolicyListIndexUpdate(tx, policy.id);

      return { policy };
    });

    if (!result) {
      return sendError(res, 503, 'NO_ACTIVE_BINDER', `No active binder linked for ${productType} in this tenant`);
    }

    // Document generation is enforced at bind time (generation-first contract).

    res.setHeader('X-Optimization', 'Active');
    res.status(201).json({
      success: true,
      data: result.policy,
    });

    // Audit log (best-effort)
    try {
      await AuditLogger.log(
        String(result.policy.id),
        'POLICY',
        'POLICY.SESSION_CREATED',
        actor.id || 'system',
        actor.role ? 'USER' : 'SYSTEM',
        { policyNumber: result.policy.policyNumber, origin: 'bo' },
        actor.name || actor.email || 'Backoffice'
      );
    } catch {
      // ignore
    }
    return;

  } catch (error) {
    logger.error({ err: error }, 'Create policy error:');
    return sendError(res, 500, 'CREATE_ERROR', errorMessage(error, 'Failed to create policy'));
  }
};
