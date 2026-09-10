/**
 * PriceCalculationAudit recorder.
 *
 * Every rate event (new quote, BO rerate, endorsement rate, cancellation/proration
 * rate) must persist a row here. The row is immutable and append-only — never
 * updated, never deleted (policy cascade deletion aside).
 *
 * Downstream consumers:
 *   - BO "Calculation history" modal (shows one row per rate event).
 *   - BDX reconciliation tool: every reported premium line references an auditId.
 *   - Internal forensics: `reproHash` lets us detect drift between calculator
 *     versions or between rerates that should have produced identical outputs.
 */
import { createHash } from 'node:crypto';
import { prisma } from '../../../../platform/db/connection.js';
import { logger } from '../../../../platform/utils/logger.js';
import type { CalculationStep } from '../../../../platform/types/pricing.js';

export type PriceAuditEventKind = 'QUOTE' | 'RATE' | 'ENDORSEMENT_RATE' | 'CANCELLATION_RATE';

export interface RecordPriceAuditArgs {
  policyId?: string | null;
  riskTransactionId?: string | null;
  quoteId?: string | null;
  productType: string;
  calculatorVersion: string;
  inputs: Record<string, unknown>;
  steps: CalculationStep[];
  totalPremium: number;
  policyExcess?: number | null;
  currency?: string;
  eventKind: PriceAuditEventKind;
  createdBy?: string | null;
}

function computeReproHash(calculatorVersion: string, inputs: Record<string, unknown>): string {
  // Stable deterministic hash — sort object keys before hashing so logically
  // equal inputs produce equal hashes regardless of JSON serialization order.
  const normalized = JSON.stringify(inputs, Object.keys(inputs).sort());
  return createHash('sha256').update(`${calculatorVersion}|${normalized}`).digest('hex');
}

/**
 * Persist a price calculation audit row. Best-effort: logs and swallows errors
 * so a persistence outage never blocks a live rate flow.
 */
export async function recordPriceAudit(args: RecordPriceAuditArgs): Promise<string | null> {
  try {
    if (!args.steps || args.steps.length === 0) {
      logger.warn({ event: 'price_audit.skipped_no_steps', productType: args.productType, eventKind: args.eventKind });
      return null;
    }
    const reproHash = computeReproHash(args.calculatorVersion, args.inputs);
    const row = await prisma.priceCalculationAudit.create({
      data: {
        policyId: args.policyId ?? null,
        riskTransactionId: args.riskTransactionId ?? null,
        quoteId: args.quoteId ?? null,
        productType: String(args.productType).toUpperCase(),
        calculatorVersion: args.calculatorVersion,
        inputs: args.inputs as unknown as object,
        steps: args.steps as unknown as object,
        totalPremium: Number(args.totalPremium.toFixed(2)),
        policyExcess: typeof args.policyExcess === 'number' ? Number(args.policyExcess.toFixed(2)) : null,
        currency: args.currency || 'EUR',
        reproHash,
        eventKind: args.eventKind,
        createdBy: args.createdBy ?? null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    logger.error({ err, event: 'price_audit.persist_failed', productType: args.productType, eventKind: args.eventKind }, 'Failed to record price audit');
    return null;
  }
}

/** Latest audit rows for a policy, newest first. */
export async function listPriceAudit(policyId: string, limit = 20) {
  return prisma.priceCalculationAudit.findMany({
    where: { policyId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, limit), 100),
  });
}
