/**
 * Reconciliation Matcher — App Layer Adapter
 *
 * CHAMPS: Wires pure domain matching functions (from domain/reconciliation/matcher)
 * with side-effectful operations that require infra (repository) access.
 * This is the single import point used by the HTTP layer.
 */

import {
  getSuggestedMatches,
  exportReconciliationJournal,
  validateReconciliation,
  AMOUNT_TOLERANCE,
  type InvoiceRecord,
  type InvoiceWithPolicy,
  type ReconciliationRecord,
} from '../domain/reconciliation/matcher.js';

import {
  findPaidReconciliations,
  updateReconciliation,
  updateInvoiceStatus,
  createReceiptDocument,
  createBalanceInvoice,
} from '../infra/reconciliationRepository.js';

import { logger } from '../../../platform/utils/logger.js';

// ─── Side-Effectful Operations (app layer owns DB orchestration) ────

async function getPaidAmount(invoice: InvoiceRecord): Promise<number> {
  const reconciliations = await findPaidReconciliations(invoice.id);
  return reconciliations.reduce((sum, rec) => sum + Number(rec.matchedAmount || 0), 0);
}

async function reconcilePayment(
  reconciliation: ReconciliationRecord,
  invoice: InvoiceRecord
): Promise<ReconciliationRecord> {
  const commissionRate = invoice.commissionRate ? Number(invoice.commissionRate) : 0.15;
  const netMultiplier = 1 - commissionRate;

  const invoiceGrossAmount = Number(invoice.amount);
  const invoiceNetAmount = invoiceGrossAmount * netMultiplier;

  const paymentAmount = Number(reconciliation.paymentAmount);
  const currentPaidAmount = await getPaidAmount(invoice);

  const newPaidAmount = currentPaidAmount + paymentAmount;

  let status: string = 'UNAPPLIED';
  let matchedAmount = paymentAmount;

  logger.info(`[ReconcilePayment] Gross: ${invoiceGrossAmount}, Rate: ${commissionRate}, Net: ${invoiceNetAmount.toFixed(2)}, PaidSoFar: ${currentPaidAmount}`);

  // Determine Match Status
  if (Math.abs(newPaidAmount - invoiceNetAmount) <= AMOUNT_TOLERANCE) {
    status = 'MATCHED';
    matchedAmount = paymentAmount;
    logger.info('[ReconcilePayment] Status: MATCHED (Fully Paid Net)');
  } else if (Math.abs(newPaidAmount - invoiceGrossAmount) <= AMOUNT_TOLERANCE) {
    status = 'MATCHED';
    matchedAmount = paymentAmount;
    logger.info('[ReconcilePayment] Status: MATCHED (Fully Paid Gross)');
  } else if (newPaidAmount < invoiceNetAmount) {
    status = 'PARTIAL';
    matchedAmount = paymentAmount;
    logger.info('[ReconcilePayment] Status: PARTIAL');
  } else {
    status = 'EXCEPTION';
    matchedAmount = paymentAmount;
    logger.info('[ReconcilePayment] Status: EXCEPTION (Possible Overpayment)');
  }

  // Update Reconciliation
  const updatedReconciliation = await updateReconciliation(reconciliation.id, {
    invoiceId: invoice.id,
    status,
    matchedAmount,
  });

  // Update Invoice Status
  let invoiceStatus = invoice.status;
  if (status === 'MATCHED') {
    invoiceStatus = 'PAID';
  } else if (status === 'PARTIAL') {
    invoiceStatus = 'PARTIAL';
  }

  await updateInvoiceStatus(invoice.id, {
    status: invoiceStatus,
    paidDate: status === 'MATCHED' ? new Date() : undefined,
  });

  // [AGENTIC FEATURE] Auto-generate Receipt for Fully Paid
  if (status === 'MATCHED') {
    try {
      logger.info('[Reconcile] Status is MATCHED. Generating Receipt...');
      const { generateReceiptDocx } = await import('../../documents/app/invoiceGenerator.js');

      const invoiceRec = invoice as InvoiceWithPolicy;
      const policyHolder = invoiceRec?.policy?.policyHolder || {};
      const invoiceData = {
        client: policyHolder.name || 'Valued Customer',
        address: policyHolder.address || 'Address',
        reference: invoice.id,
        PolicyReference: invoiceRec?.policy?.policyNumber || '',
        Cover: 'Auto Insurance Payment',
        Total: matchedAmount.toFixed(2),
        Date: new Date(),
      };

      const { url } = await generateReceiptDocx(invoice.id, invoiceData, Number(matchedAmount), new Date());

      if (invoice.policyId) {
        await createReceiptDocument({
          policyId: invoice.policyId,
          storageUri: url,
          filename: `Receipt_${reconciliation.paymentReference}.pdf`,
        });
        logger.info(`[Reconcile] Receipt generated: ${url}`);
      }
    } catch (err) {
      logger.error({ err: err }, '[Reconcile] Failed to generate receipt:');
    }
  }

  // [AGENTIC FEATURE] Auto-generate Balance Invoice
  if (status === 'PARTIAL' || (status === 'EXCEPTION' && newPaidAmount > invoiceNetAmount)) {
    const isOverpayment = newPaidAmount > invoiceNetAmount;
    const diffNet = isOverpayment ? (newPaidAmount - invoiceNetAmount) : (invoiceNetAmount - newPaidAmount);
    const diffGross = diffNet / netMultiplier;

    const balanceInvoice = await createBalanceInvoice({
      policyId: invoice.policyId,
      amount: diffGross,
      dueDate: new Date(new Date().setDate(new Date().getDate() + 14)),
    });

    logger.info(`[ReconcilePayment] generated ${isOverpayment ? 'Credit Note' : 'Balance Invoice'} ${balanceInvoice.id} for Gross: ${diffGross.toFixed(2)}`);
  }

  return updatedReconciliation as ReconciliationRecord;
}

// ─── Façade Export ───────────────────────────────────────────────────

export const reconciliationMatcher = {
  getSuggestedMatches,
  reconcilePayment,
  exportReconciliationJournal,
  validateReconciliation,
};
