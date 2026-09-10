import type { NextFunction, Request, Response, Router } from 'express';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { jsonParse } from '../app/shared.js';
import {
  isEndorsementTransactionType,
  isIssuanceTransactionType,
} from '../app/riskTransactionTypes.js';

import { logger } from '../../../platform/utils/logger.js';
import { buildProductVersionMeta, buildProductVersionRows, getProductDisplaySection, productAdapterExists } from '../app/productRegistryService.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { errorMessage } from '../../../platform/http/httpErrors.js';
function policyVersionsAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

export function allocateSectionPremiums(args: {
  tpl: number;
  ownDamage: number;
  hasOwnDamage: boolean;
  total: number;
  tplBasis?: number;
  ownDamageBasis?: number;
}): { tpl: number; ownDamage: number } {
  const tplRaw = Number(args.tpl) || 0;
  const ownRaw = Number(args.ownDamage) || 0;
  const total = Number(args.total) || 0;
  const hasOwnDamage = Boolean(args.hasOwnDamage);
  if (!hasOwnDamage) return { tpl: total, ownDamage: 0 };

  const base = Math.abs(tplRaw) + Math.abs(ownRaw);
  if (base <= 0) {
    const tplBasis = Math.abs(Number(args.tplBasis) || 0);
    const ownBasis = Math.abs(Number(args.ownDamageBasis) || 0);
    const basisTotal = tplBasis + ownBasis;
    if (basisTotal <= 0) return { tpl: total, ownDamage: 0 };
    const tplShare = tplBasis / basisTotal;
    const tplAllocated = Number((total * tplShare).toFixed(2));
    const ownAllocated = Number((total - tplAllocated).toFixed(2));
    return { tpl: tplAllocated, ownDamage: ownAllocated };
  }
  const tplShare = Math.abs(tplRaw) / base;
  const tplAllocated = Number((total * tplShare).toFixed(2));
  const ownAllocated = Number((total - tplAllocated).toFixed(2));
  return { tpl: tplAllocated, ownDamage: ownAllocated };
}

/**
 * Policy version history routes (RiskTransaction-backed).
 * URL paths + response shapes are part of the OpenAPI surface; consult that as the single source of truth before changing them.
 */
export function registerPolicyVersionRoutes(router: Router) {
  /**
   * GET /api/policies/:id/versions
   * RiskTransaction-backed version history (issued + drafts).
   */
  router.get('/:id/versions', policyVersionsAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        select: { id: true, productType: true, priorTermPolicyId: true, renewalSequence: true },
      });
      if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });

      const riskTransactions = await tenantScopedPrisma.riskTransaction.findMany({
        where: { policyId },
        orderBy: { transactionNumber: 'desc' },
        include: { premiumTransactions: { include: { taxLines: true } } },
      });

      const policyProductType = String(policy?.productType || '').toUpperCase();
      const section = productAdapterExists(policyProductType) ? getProductDisplaySection(policyProductType) : '—';

      const num = (x: unknown) => {
        const v = Number(x);
        return Number.isFinite(v) ? v : 0;
      };

      const boundByTxn = new Map<number, { snap: Record<string, unknown>; pricing: Record<string, unknown> }>();
      for (const rt of riskTransactions || []) {
        if (String(rt.status || '').toUpperCase() !== 'BOUND') continue;
        boundByTxn.set(Number(rt.transactionNumber || 0), {
          snap: parseRecord(jsonParse(rt.snapshotFinal)),
          pricing: parseRecord(jsonParse(rt.pricingFinal)),
        });
      }

      const versions = (riskTransactions || []).map((rt) => {
        const st = String(rt.status || '').toUpperCase();
        const type = String(rt.transactionType || '').toUpperCase();
        const pricing = st === 'BOUND' ? parseRecord(jsonParse(rt.pricingFinal)) : {};
        const snap = st === 'BOUND' ? parseRecord(jsonParse(rt.snapshotFinal)) : parseRecord(jsonParse(rt.snapshotDraft));
        const quoteResponse = parseRecord(snap.quoteResponse || pricing.quoteResponse);
        const primaryOption = parseRecord(quoteResponse.primaryOption);
        const draftPremium = primaryOption.annualPremium ?? primaryOption.totalPremium ?? quoteResponse.annualPremium ?? null;
        const currency = String(pricing.currency || quoteResponse.currency || 'EUR');

        const qd = parseRecord(snap.quoteData);
        const versionMeta = productAdapterExists(policyProductType) ? buildProductVersionMeta(policyProductType, qd) : null;
        const limitAmount = versionMeta ? Number(versionMeta.insuredValueDisplay?.replace(/[^0-9.]/g, '') || 0) || null : null;

        const workspace = parseRecord(snap.endorsementWorkspace);
        const reasonCodeUpper = String(workspace.reasonCode || '').toUpperCase();
        const hasCancellationSnapshot = Boolean(parseRecord(pricing.cancellationSnapshot).type);
        const isCancellation = isEndorsementTransactionType(type) && (reasonCodeUpper === 'CANCELLATION' || hasCancellationSnapshot);
        const isRenewalTermBaseline =
          type === 'INCEPTION'
          && Number(rt.transactionNumber || 0) === 1
          && Boolean(policy?.priorTermPolicyId);
        const riskTransTypeLabel =
          isRenewalTermBaseline ? 'Renewal'
          : type === 'INCEPTION' ? 'New'
          : type === 'RENEWAL' ? 'Renewal'
          : isEndorsementTransactionType(type) ? (isCancellation ? 'Cancellation' : 'Endorsement')
          : type;

        const useFullPremium = isIssuanceTransactionType(type);
        const premiumDeltaTotal = num(
          Array.isArray(rt.premiumTransactions) && rt.premiumTransactions.length > 0
            ? rt.premiumTransactions.reduce((acc, p) => acc + num(p.grossPremium), 0)
            : num(draftPremium)
        );
        const boundPremium = st === 'BOUND' ? premiumDeltaTotal : draftPremium;

        const previousBound = (() => {
          const txNo = Number(rt.transactionNumber || 0);
          let best: { snap: Record<string, unknown>; pricing: Record<string, unknown> } | null = null;
          let bestNo = -1;
          for (const [n, rec] of boundByTxn.entries()) {
            if (n < txNo && n > bestNo) { best = rec; bestNo = n; }
          }
          return best;
        })();

        const bdxRows = productAdapterExists(policyProductType)
          ? buildProductVersionRows(policyProductType, {
              quoteData: qd,
              quoteResponse,
              pricing,
              previousQuoteResponse: previousBound ? parseRecord(previousBound.snap.quoteResponse || previousBound.pricing.quoteResponse) : null,
              previousPricing: previousBound ? previousBound.pricing : null,
              transactionType: type,
              isCancellation: isCancellation && st === 'BOUND',
              riskTransTypeLabel,
              isFullPremium: useFullPremium,
              premiumDeltaTotal,
              versionMeta,
            })
          : [{ section: '—', riskTransType: riskTransTypeLabel, limitText: '—', excessText: '—', premium: premiumDeltaTotal, currency }];

        return {
          riskTransactionId: rt.id,
          transactionNumber: rt.transactionNumber,
          transactionType: type,
          transactionTypeDisplay: isRenewalTermBaseline ? 'RENEWAL' : type,
          status: st,
          effectiveDate: rt.effectiveDate,
          expiryDate: rt.expiryDate,
          issuedByUserId: rt.issuedByUserId || null,
          premiumSnapshot: boundPremium,
          currency,
          section,
          limitAmount,
          bdxRows: bdxRows.map((row) => ({ riskTransactionId: rt.id, transactionNumber: rt.transactionNumber, effectiveDate: rt.effectiveDate, ...row })),
        };
      });

      return res.json({ success: true, data: versions });
    } catch (error) {
      logger.error({ err: error }, 'List versions error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to list versions') } });
    }
  });

  /**
   * GET /api/policies/:id/versions/:riskTransactionId/snapshot
   * Returns the snapshot/pricing for the selected version.
   */
  router.get('/:id/versions/:riskTransactionId/snapshot', policyVersionsAuditLog, async (req, res) => {
    try {
      const { id: policyId, riskTransactionId } = req.params;
      const rt = await tenantScopedPrisma.riskTransaction.findFirst({ where: { id: riskTransactionId, policyId } });
      if (!rt) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Version not found' } });

      const st = String(rt.status || '').toUpperCase();
      const snapshot = st === 'BOUND' ? parseRecord(jsonParse(rt.snapshotFinal)) : parseRecord(jsonParse(rt.snapshotDraft));
      const pricing = st === 'BOUND' ? parseRecord(jsonParse(rt.pricingFinal)) : null;

      return res.json({
        success: true,
        data: {
          riskTransactionId: rt.id,
          transactionNumber: rt.transactionNumber,
          transactionType: rt.transactionType,
          status: rt.status,
          effectiveDate: rt.effectiveDate,
          expiryDate: rt.expiryDate,
          snapshot: snapshot || {},
          pricing,
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'Get version snapshot error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to fetch version snapshot') } });
    }
  });
}

