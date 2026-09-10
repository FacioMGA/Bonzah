// FacioMGA - Reconciliation Matcher (Domain Layer)
// Pure matching logic — no DB, no side effects.

import type {
  BankPayment,
  ReconciliationMatch,
  ValidationResult,
} from '../../../../platform/types/index.js';

import { logger } from '../../../../platform/utils/logger.js';

// ─── Domain-owned types ─────────────────────────────────────────────

/** Minimal Invoice shape used by the reconciliation domain. */
export type InvoiceRecord = {
  id: string;
  policyId: string | null;
  amount: number | { toNumber(): number } | null;
  commissionRate?: number | { toNumber(): number } | null;
  status: string;
  dueDate: Date;
  policyNumber?: string;
  policy?: { policyNumber?: string; policyHolder?: { name?: string | null; address?: string | null } } | null;
};

/** Minimal Reconciliation shape used by the reconciliation domain. */
export type ReconciliationRecord = {
  id: string;
  invoiceId: string | null;
  paymentReference: string;
  paymentAmount: number | { toString(): string };
  paymentDate: Date;
  paymentMethod: string;
  matchedAmount?: number | { toString(): string } | null;
  status: string;
  policyId?: string | null;
};

// ─── Constants ───────────────────────────────────────────────────────

// Tolerance for fuzzy matching (±$0.01 per SOW requirement)
const AMOUNT_TOLERANCE = 0.01;
const SMART_MATCH_TOLERANCE = 0.02; // 2% tolerance for smart matching

// Hardcoded commission rate (15%) until supported by schema
const COMMISSION_RATE = 0.15;
const NET_MULTIPLIER = 1 - COMMISSION_RATE;

export { AMOUNT_TOLERANCE };

type InvoiceWithPolicy = InvoiceRecord & {
  policy?: { policyNumber?: string; policyHolder?: { name?: string; address?: string } } | null;
};

export type { InvoiceWithPolicy };

// ─── Pure Matching Functions ─────────────────────────────────────────

/**
 * Get multiple ranked invoice suggestions for a payment
 * Returns top 3 matches with confidence scores
 */
export function getSuggestedMatches(
  payment: BankPayment,
  invoices: InvoiceRecord[]
): Array<ReconciliationMatch & { invoice: InvoiceRecord }> {
  logger.info('=== getSuggestedMatches DEBUG ===');
  logger.info({ data: payment }, 'Payment:');

  const suggestions = invoices
    .map(invoice => {
      const commissionRate = invoice.commissionRate ? Number(invoice.commissionRate) : 0.15;
      const netMultiplier = 1 - commissionRate;

      const grossAmount = Number(invoice.amount);
      const netAmount = grossAmount * netMultiplier;

      const amountDifference = Math.abs(payment.amount - netAmount);
      const amountTolerance = netAmount * SMART_MATCH_TOLERANCE;

      let confidence = 0;
      let matchType: 'EXACT' | 'FUZZY' | 'PARTIAL' | 'EXCEPTION' = 'EXCEPTION';
      let notes = '';

      const idMatch = payment.reference.toUpperCase().includes(invoice.id.toUpperCase().substring(0, 8));

      const payerName = (payment.description || '').toLowerCase();
      const invoiceRec = invoice as InvoiceWithPolicy;
      const insuredName = invoiceRec?.policy?.policyHolder?.name
        ? invoiceRec.policy.policyHolder.name.toLowerCase()
        : '';
      const insuredParts = insuredName.split(' ').filter((p: string) => p.length > 2);

      let nameScore = 0;
      if (insuredName && payerName.includes(insuredName)) nameScore = 1.0;
      else if (insuredName && insuredParts.some((part: string) => payerName.includes(part))) nameScore = 0.5;

      if (idMatch && amountDifference <= AMOUNT_TOLERANCE) {
        confidence = 0.95;
        matchType = 'EXACT';
        notes = `Exact Net Match (Rate: ${(commissionRate * 100).toFixed(1)}%)`;
      } else if (nameScore > 0.8 && amountDifference <= AMOUNT_TOLERANCE) {
        confidence = 0.92;
        matchType = 'EXACT';
        notes = 'Payer Name & Net Amount Match';
      } else if (idMatch) {
        confidence = 0.85;
        matchType = 'FUZZY';
        notes = 'Invoice ID found in payment reference';
      } else if (nameScore > 0.5 && amountDifference <= amountTolerance) {
        confidence = 0.82;
        matchType = 'FUZZY';
        notes = 'Payer name match with slight amount difference';
      } else if (amountDifference <= AMOUNT_TOLERANCE) {
        confidence = 0.80;
        matchType = 'EXACT';
        notes = 'Exact Net Amount match';
      } else if (amountDifference <= amountTolerance) {
        confidence = 0.70 - (amountDifference / amountTolerance) * 0.2;
        matchType = 'FUZZY';
        notes = `Amount within ${(SMART_MATCH_TOLERANCE * 100).toFixed(0)}% tolerance of Net Amount`;
      } else if (payment.amount < netAmount && payment.amount > netAmount * 0.5) {
        confidence = 0.60;
        matchType = 'PARTIAL';
        notes = 'Possible partial payment';
      }

      return {
        invoice,
        invoiceId: invoice.id,
        matchType,
        matchedAmount: payment.amount,
        tolerance: amountDifference,
        confidence,
        notes,
      };
    })
    .filter(match => match.confidence > 0.5)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  return suggestions;
}

/**
 * Match bank payment to invoices
 */
export function matchPaymentToInvoice(
  payment: BankPayment,
  invoices: InvoiceRecord[]
): ReconciliationMatch {
  const exactMatch = invoices.find(invoice =>
    invoice.id.includes(payment.reference) ||
    payment.reference.includes(invoice.id)
  );

  if (exactMatch) {
    const netAmount = Number(exactMatch.amount) * NET_MULTIPLIER;
    const difference = Math.abs(payment.amount - netAmount);

    if (difference <= AMOUNT_TOLERANCE) {
      return {
        invoiceId: exactMatch.id,
        matchType: difference <= AMOUNT_TOLERANCE ? 'EXACT' : 'FUZZY',
        matchedAmount: payment.amount,
        tolerance: difference,
        confidence: 1.0,
        notes: `Matched by invoice ID: ${exactMatch.id}`,
      };
    }
  }

  const fuzzyMatches = invoices
    .map(invoice => {
      const netAmount = Number(invoice.amount) * NET_MULTIPLIER;
      const difference = Math.abs(payment.amount - netAmount);

      return {
        invoice,
        difference,
        confidence: calculateConfidence(payment, invoice, difference),
      };
    })
    .filter(match => match.difference <= AMOUNT_TOLERANCE)
    .sort((a, b) => a.difference - b.difference);

  if (fuzzyMatches.length > 0) {
    const bestMatch = fuzzyMatches[0];
    return {
      invoiceId: bestMatch.invoice.id,
      matchType: 'FUZZY',
      matchedAmount: payment.amount,
      tolerance: bestMatch.difference,
      confidence: bestMatch.confidence,
      notes: `Fuzzy match by Net Amount: ${bestMatch.invoice.id}`,
    };
  }

  return {
    invoiceId: '',
    matchType: 'EXCEPTION',
    matchedAmount: 0,
    tolerance: 0,
    confidence: 0,
    notes: `No matching invoice found for payment ${payment.reference}`,
  };
}

function calculateConfidence(
  payment: BankPayment,
  invoice: InvoiceRecord,
  amountDifference: number
): number {
  let confidence = 1.0;
  confidence -= (amountDifference / AMOUNT_TOLERANCE) * 0.1;

  const dateDifference = Math.abs(
    payment.date.getTime() - invoice.dueDate.getTime()
  );
  const daysDifference = dateDifference / (1000 * 60 * 60 * 24);

  if (daysDifference <= 7) confidence += 0.1;
  else if (daysDifference <= 30) confidence += 0.05;

  if (payment.reference.includes(invoice.id)) confidence += 0.2;

  return Math.min(1.0, Math.max(0.0, confidence));
}

// ─── Pure Helpers (no DB) ────────────────────────────────────────────

export function exportReconciliationJournal(
  reconciliations: ReconciliationRecord[]
): string {
  const lines: string[] = [];
  lines.push('Reconciliation ID,Invoice ID,Payment Reference,Payment Amount,Matched Amount,Status,Payment Date,Payment Method');

  for (const rec of reconciliations) {
    lines.push([
      rec.id,
      rec.invoiceId || '',
      rec.paymentReference,
      rec.paymentAmount.toString(),
      rec.matchedAmount?.toString() || '0',
      rec.status,
      rec.paymentDate.toISOString().split('T')[0],
      rec.paymentMethod,
    ].join(','));
  }

  return lines.join('\n');
}

export function validateReconciliation(reconciliation: ReconciliationRecord): ValidationResult {
  const errors: string[] = [];
  if (!reconciliation.paymentReference) errors.push('Payment reference is required');
  if (Number(reconciliation.paymentAmount) <= 0) errors.push('Payment amount must be > 0');

  return { isValid: errors.length === 0, errors };
}
