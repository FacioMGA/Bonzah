import type { NextFunction, Request, Response, Router } from 'express';
import type { ApiResponse } from '../../../platform/types/index.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { buildMagicBSectionsForSchedule, MagicB } from '../app/mbeInterop.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import {
  buildProductDocumentViewModel,
  productAdapterExists,
  resolvePublishedProgramDocumentConfiguration,
} from '../app/productRegistryService.js';
import { jsonParse } from '../app/shared.js';
import { derivePolicyState } from '../app/policyStateService.js';
import { evaluatePolicyCompliance } from '../app/policyCompliance.js';
import { resolveCoverageContractForHttp } from '../app/coverageSelectionHttpProjection.js';
import {
  buildBoOverrideOverlayTrigger,
  buildUnderwritingAnalysis,
  buildValueMismatchOverlayTrigger,
} from '../../underwriting/app/underwritingAnalysis.js';
import { logger } from '../../../platform/utils/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { deepMergeQuoteData } from '../../../shared/lib/deepMerge.js';
type ErrorBody = ApiResponse<null>;

export { deepMergeQuoteData };

function parseSnapshot(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return parseRecord(value);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/*
 * ABY-256 — deep-merge two quoteData snapshots, preferring non-empty
 * leaf values from the SNAPSHOT side over the POLICY side.
 *
 * Why this exists
 * ---------------
 * The BO `/policies/<id>` BFF previously did `{ ...policyData, ...snapshot }`
 * — a top-level spread. That made `snapshot.quoteData` (if present)
 * entirely replace `policy.quoteData`, even if the snapshot was missing
 * fields (e.g. `proposer.phone`) that the policy column still carried.
 * The customer entered their phone in the wizard, the payment-side
 * worker updated `policy.quoteData` with the materialized contact, but
 * the wizard's stored snapshot didn't include phone — and the BO
 * underwriting tab ended up reading from the merged-but-blanked
 * snapshot value.
 *
 * The deep merge keeps the snapshot as the primary source of truth
 * (it's the latest wizard state) but falls back per-leaf to the
 * policy column when the snapshot has an empty / missing value. The
 * recursion only descends into plain objects; arrays and primitives
 * are taken whole from whichever side has a non-empty value.
 *
 * Empty here means: `null`, `undefined`, or empty string. `false`,
 * `0`, and empty arrays/objects are intentionally NOT treated as
 * empty — those are valid customer answers.
 *
 * Implementation: `backend/shared/lib/deepMerge.ts` `deepMergeQuoteData`.
 */

function sendError(res: { status: (code: number) => { json: (payload: ErrorBody) => unknown } }, status: number, code: string, message: string) {
  const payload: ErrorBody = {
    success: false,
    error: { code, message },
  };
  return res.status(status).json(payload);
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

export function registerPolicyDetailRoutes(router: Router) {
  /**
   * GET /api/policies/:id
   * Get policy + Current Snapshot
   */
  router.get('/:id', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const includeDocView = String(parseRecord(req.query).includeDocView || '').trim() === '1';
      logger.info(`[API] Fetching policy ${id} with documentSets...`);
      const [policy, currentState, riskTransactions, claims, documents] = await Promise.all([
        tenantScopedPrisma.policy.findUnique({
          where: { id },
          include: {
            policyHolder: true,
            invoices: { orderBy: { createdAt: 'desc' } },
            quoteHistory: { orderBy: { archivedAt: 'desc' } },
            documentSets: { orderBy: { createdAt: 'desc' } },
            listIndex: { select: { totalPremium: true } },
            assignment: true,
          }
        }),
        tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: id } }),
        tenantScopedPrisma.riskTransaction.findMany({
          where: { policyId: id },
          select: {
            status: true,
            transactionType: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        tenantScopedPrisma.claim.findMany({
          where: { policyId: id },
          select: { status: true },
        }),
        tenantScopedPrisma.document.findMany({
          where: { policyId: id },
          select: { status: true, type: true },
        }),
      ]);

      if (!policy) {
        return sendError(res, 404, 'NOT_FOUND', 'Policy not found');
      }
      const familyPolicies = await tenantScopedPrisma.policy.findMany({
        where: { renewalFamilyId: policy.renewalFamilyId },
        orderBy: [{ renewalSequence: 'asc' }, { inceptionDate: 'asc' }],
        select: {
          id: true,
          policyNumber: true,
          status: true,
          inceptionDate: true,
          expiryDate: true,
          renewalSequence: true,
          priorTermPolicyId: true,
        },
      });
      const familyIndex = familyPolicies.findIndex((term) => term.id === policy.id);
      const previousTerm = familyIndex > 0 ? familyPolicies[familyIndex - 1] : null;
      const nextTerm = familyIndex >= 0 && familyIndex < familyPolicies.length - 1 ? familyPolicies[familyIndex + 1] : null;

      const snapshot = currentState ? parseSnapshot(jsonParse(currentState.snapshot)) : {};
      const derivedState = derivePolicyState({
        status: policy.status,
        inceptionDate: policy.inceptionDate,
        expiryDate: policy.expiryDate,
        isLocked: policy.isLocked,
        stateCurrentSnapshot: snapshot,
        riskTransactions,
        claims,
      });
      const premium = toNum(policy.listIndex?.totalPremium);
      const unpaidStatuses = new Set(['DRAFT', 'OPEN', 'OVERDUE', 'PENDING', 'UNPAID', 'PARTIAL']);
      const now = Date.now();
      let outstandingBalance = 0;
      let invoiceOverdue = false;
      for (const inv of policy.invoices || []) {
        const invStatus = String(inv.status || '').toUpperCase();
        if (unpaidStatuses.has(invStatus)) {
          outstandingBalance += toNum(inv.amount);
          const dueMs = inv.dueDate ? new Date(inv.dueDate).getTime() : NaN;
          if (Number.isFinite(dueMs) && dueMs < now) invoiceOverdue = true;
        }
      }
      const compliance = evaluatePolicyCompliance({
        policyNumber: policy.policyNumber,
        productType: policy.productType,
        status: policy.status,
        boStatus: derivedState.boStatus,
        binderId: policy.binderId,
        programId: policy.programId,
        paymentStatus: policy.paymentStatus,
        inceptionDate: policy.inceptionDate,
        expiryDate: policy.expiryDate,
        isLocked: policy.isLocked,
        quoteData: policy.quoteData,
        stateCurrentSnapshot: snapshot,
        riskTransactions,
        documents,
        claims,
        outstandingBalance,
        invoiceOverdue,
        totalPremium: premium,
      });

      // Parse PolicyHolder contact if present
      const policyHolder = policy.policyHolder && typeof policy.policyHolder.contact === 'string'
        ? { ...policy.policyHolder, contact: jsonParse(policy.policyHolder.contact) }
        : policy.policyHolder;
      const policyData = { ...policy, policyHolder };
      const policyRecord = parseRecord(policyData);

      if (policyData.policyHolder && typeof policyData.policyHolder.contact === 'string') {
        policyData.policyHolder.contact = jsonParse(policyData.policyHolder.contact);
      }

      // Enrich invoices with UI fields
      const enrichedInvoices = (policyData.invoices || []).map((inv) => ({
        ...inv,
        date: inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : new Date(inv.createdAt).toLocaleDateString(),
        status: inv.status || 'OPEN',
      }));

      // Combine for UI (BFF)
      // ABY-256 — `quoteData` specifically is deep-merged so a snapshot
      // missing nested proposer fields (e.g. phone) doesn't blank them
      // out from the policy column; every other top-level key keeps the
      // existing shallow precedence (snapshot wins for units, premium,
      // etc.). See `deepMergeQuoteData` for the empty-value semantics.
      const mergedQuoteData = deepMergeQuoteData(
        (policyData as Record<string, unknown>).quoteData,
        (snapshot as Record<string, unknown>).quoteData,
      );
      const responseData: Record<string, unknown> = {
        ...policyData,
        ...snapshot, // Merge snapshot fields (units, premium, etc) over header
        quoteData: mergedQuoteData,
        // Status comes from policy header source-of-truth; never let stale snapshot overwrite it.
        status: policyData.status,
        bo_status: derivedState.boStatus,
        bo_statusSortRank: derivedState.boStatusSortRank,
        paymentStatus: policy.paymentStatus,
        outstandingBalance,
        complianceState: compliance.state,
        complianceProfile: compliance.profile,
        complianceReasons: compliance.reasonCodes,
        premium,
        totalPremium: premium,
        invoices: enrichedInvoices, // Override with enriched
        renewalFamilyId: policy.renewalFamilyId,
        priorTermPolicyId: policy.priorTermPolicyId,
        renewalSequence: policy.renewalSequence,
        renewalFamily: {
          previousTermPolicyId: previousTerm?.id || null,
          nextTermPolicyId: nextTerm?.id || null,
          terms: familyPolicies,
        },
        quoteHistory: (policyData.quoteHistory || []).map((h) => ({
          ...h,
          snapshot: {
            quoteData: h.quoteData || {},
            quoteResponse: h.quoteResponse || {},
            isLockedSnapshot: Boolean(h.isLockedSnapshot),
          },
        })),
      };
      const responsePricing = parseRecord(responseData.pricing);
      const boOverrideApproval = parseRecord(responsePricing.boOverrideApproval);
      const enrichedMismatch = parseRecord(responsePricing.enrichedMismatch);
      responseData.underwritingAnalysis = buildUnderwritingAnalysis({
        uwDecision: parseRecord(responseData.uwDecision),
        quoteResponse: parseRecord(responseData.quoteResponse),
        overlayTriggers: [
          ...(boOverrideApproval.required === true
            ? [buildBoOverrideOverlayTrigger({
              requestedOverrideExcess: toNum(boOverrideApproval.requestedOverrideExcess),
              computedMinimumExcess: toNum(boOverrideApproval.computedMinimumExcess),
            })]
            : []),
          ...(toNum(enrichedMismatch.declaredValue) > 0 && toNum(enrichedMismatch.marketValue) > 0
            ? [buildValueMismatchOverlayTrigger({
              declaredValue: toNum(enrichedMismatch.declaredValue),
              marketValue: toNum(enrichedMismatch.marketValue),
            })]
            : []),
        ],
      });

      // Optional: provide a single shared "document view model" builder output.
      // This can be used by UI to display exactly what the PDF templates will render.
      const docViewProductType = String(policyData.productType || '');
      if (includeDocView && productAdapterExists(docViewProductType)) {
        try {
          const [binder, binderProductAuthority, activeEndorsements] = await Promise.all([
            policyData.binderId
              ? tenantScopedPrisma.binder.findUnique({ where: { id: policyData.binderId } })
              : Promise.resolve(null),
            policyData.binderId && docViewProductType
              ? tenantScopedPrisma.binderProductAuthority.findUnique({
                where: { binderId_productCode: { binderId: policyData.binderId, productCode: docViewProductType } },
                select: { id: true },
              })
              : Promise.resolve(null),
            tenantScopedPrisma.endorsementInstance.findMany({
              where: { policyId: id, status: { in: ['APPLIED', 'PENDING'] } },
              include: { template: true },
            }),
          ]);
          if (!policyData.programId || !binderProductAuthority) {
            throw new Error('Document preview requires the policy programme and active binder authority.');
          }
          const documentConfiguration = await resolvePublishedProgramDocumentConfiguration({
            productType: docViewProductType,
            programId: policyData.programId,
            binderProductAuthorityId: binderProductAuthority.id,
          });
          const { brand, normalizedMbeCfg } = documentConfiguration;

          const snap = parseRecord(snapshot);
          const qd = snap.quoteData || {};
          const baseApplied = resolveCoverageContractForHttp({
            productType: String(policyData.productType || ''),
            quoteData: qd,
            cfg: normalizedMbeCfg,
            storedSelection: snap.coverageSelection,
            programId: policyData.programId,
            source: 'DETAILS_DOCVIEW',
          }).resolvedCoverageSet.applied;
          const combinedApplied = (() => {
            const out = new Map<string, Record<string, unknown>>();
            (baseApplied || []).forEach((x) => out.set(String(parseRecord(x).code), parseRecord(parseRecord(x).params)));
            (activeEndorsements || []).forEach((e) => out.set(String(e.code), parseRecord(e.params)));
            return Array.from(out.entries()).map(([code, params]) => ({ code, params }));
          })();

          const mbeSections = buildMagicBSectionsForSchedule({ quoteData: qd, applied: combinedApplied });

          responseData.docViewModel = buildProductDocumentViewModel({
            productType: docViewProductType,
            policyRecord,
            snapshotRecord: snap,
            binder,
            activeEndorsements,
            brand,
            normalizedMbeCfg,
            mbeSections,
          }) || undefined;
        } catch {
          // best-effort
        }
      }

      // --- 5. Surgical Frontend Data Sanitization ---
      if (responseData.quoteResponse && typeof responseData.quoteResponse === 'object') {
        const qr = responseData.quoteResponse as Record<string, unknown>;
        if (qr.pricing && typeof qr.pricing === 'object') {
          const pricing = qr.pricing as Record<string, unknown>;
          delete pricing.calculationDetails;
          delete pricing.internalFactors;
        }
      }
      if (Array.isArray(responseData.quoteHistory)) {
        responseData.quoteHistory.forEach((h) => {
          if (h?.snapshot?.quoteResponse?.pricing && typeof h.snapshot.quoteResponse.pricing === 'object') {
            const pricing = h.snapshot.quoteResponse.pricing as Record<string, unknown>;
            delete pricing.calculationDetails;
            delete pricing.internalFactors;
          }
        });
      }
      // ----------------------------------------------

      return res.json({
        success: true,
        data: responseData,
      });
    } catch (error) {
      logger.error({ err: error }, 'Get policy error:');
      return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to load policy'));
    }
  });

  /**
   * GET /api/policies/:id/bundle
   * Endpoint: Returns Policy + History + Compliance Status + Docs
   */
  router.get('/:id/bundle', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;

      // 1. Fetch Core Data (Parallel)
      const [policy, documents, riskTransactions, currentState, documentSets] = await Promise.all([
        tenantScopedPrisma.policy.findUnique({
          where: { id },
          include: {
            policyHolder: true,
            binder: true
          }
        }),
        tenantScopedPrisma.document.findMany({
          where: { policyId: id },
          orderBy: { createdAt: 'desc' }
        }),
        tenantScopedPrisma.riskTransaction.findMany({
          where: { policyId: id },
          orderBy: { transactionNumber: 'desc' },
          include: { premiumTransactions: { include: { taxLines: true } } }
        }),
        tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: id } }),
        tenantScopedPrisma.documentSet.findMany({
          where: { policyId: id },
          orderBy: { createdAt: 'desc' }
        })
      ]);

      if (!policy) {
        return sendError(res, 404, 'NOT_FOUND', 'Policy not found');
      }

      // 2. Parse Snapshot (Current State)
      const snapshot = currentState ? parseSnapshot(jsonParse(currentState.snapshot)) : {};

      // 3. Run MagicB Compliance Check
      const context = {
        tenantId: getTenantConfig().id,
        binderId: policy.binderId || undefined,
        workflowStep: 'BIND' as const, // Assuming we want to check if it's "Bind Ready"
        region: String(parseRecord(snapshot.smartUwFormData).country || 'US'),
        streamType: 'LLOYDS_RISK' as const
      };

      // Run validation on the snapshot data
      const compliance = MagicB.validate(context, {
        ...snapshot,
        // Flatten specific fields if MagicB rules expect them at top level
        ...parseRecord(snapshot.smartUwFormData),
        premium: snapshot.premium
      });
      const complianceRecord = parseRecord(compliance);
      const complianceBlockingErrors = Array.isArray(complianceRecord.blockingErrors) ? complianceRecord.blockingErrors : [];

      // 4. Construct Bundle
      const bundle = {
        policy: {
          ...policy,
          // Helper accessors for UI
          holderName: policy.policyHolder?.name,
          binderReference: policy.binder?.agreementNumber
        },
        currentSnapshot: snapshot,
        history: riskTransactions,
        documents,
        documentSets,
        compliance: {
          status: complianceRecord.valid ? 'PASS' : (complianceBlockingErrors.length > 0 ? 'FAIL' : 'WARN'),
          matrix: compliance
        }
      };

      // --- 5. Surgical Frontend Data Sanitization ---
      if (bundle.currentSnapshot?.quoteResponse && typeof bundle.currentSnapshot.quoteResponse === 'object') {
        const qr = bundle.currentSnapshot.quoteResponse as Record<string, unknown>;
        if (qr.pricing && typeof qr.pricing === 'object') {
          const pricing = qr.pricing as Record<string, unknown>;
          delete pricing.calculationDetails;
          delete pricing.internalFactors;
        }
      }
      if (Array.isArray(bundle.history)) {
        bundle.history.forEach((tx: Record<string, unknown>) => {
          if (tx.pricingFinal) {
            try {
              const pf = typeof tx.pricingFinal === 'string' ? JSON.parse(tx.pricingFinal) : tx.pricingFinal;
              if (pf?.quoteResponse?.pricing && typeof pf.quoteResponse.pricing === 'object') {
                const pricing = pf.quoteResponse.pricing as Record<string, unknown>;
                delete pricing.calculationDetails;
                delete pricing.internalFactors;
                tx.pricingFinal = typeof tx.pricingFinal === 'string' ? JSON.stringify(pf) : pf;
              }
            } catch {
              // Ignore parse errors on older blob formats
            }
          }
        });
      }
      // ----------------------------------------------

      return res.json({
        success: true,
        data: bundle
      });

    } catch (error) {
      logger.error({ err: error }, 'Get policy bundle error:');
      return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to load policy bundle'));
    }
  });
}
