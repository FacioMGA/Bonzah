import { logger } from '../../../platform/utils/logger.js';
import { resolvePublicAppBaseUrlFromTenant } from '../../../platform/http/publicAppLinks.js';
import { retryLatestFailedCustomerEmailForPolicy } from '../../communications/app/retryFailedMessageUseCase.js';
import { sendRevisedQuoteUseCase } from '../../policy/app/quoteLifecycle/sendRevisedQuoteUseCase.js';

/**
 * ABY-516 — auto-email the Lloyd's travel quote pack when the BRIT rater
 * first lands in QUOTED.
 *
 * The legacy Abbeygate online journey emailed the quote letter (schedule +
 * certificate), the Brit single-trip IPID, and the tenant terms-of-business
 * PDF as soon as the customer received a price. Facio's motor wizard still
 * requires an explicit "email my quote" action; travel never got that surface
 * and relied on this automatic dispatch instead.
 *
 * Terms of business are attached by the email adapter for every outbound
 * customer email (ADR-0047). The IPID is included by adding TRAVEL_IPID_PDF
 * to the travel QUOTE_PACK contract.
 *
 * Best-effort: a failed customer email must never break rating.
 */
export type SendTravelQuoteEmailAfterRateInput = {
  policyId: string;
  productType: string;
  previousStatus: string;
  finalStatus: 'QUOTED' | 'REFERRAL' | 'DECLINED';
  correlationId?: string;
};

export async function sendTravelQuoteEmailAfterRate(
  input: SendTravelQuoteEmailAfterRateInput,
): Promise<void> {
  const productType = String(input.productType || '').trim().toUpperCase();
  if (productType !== 'TRAVEL') return;
  if (input.finalStatus !== 'QUOTED') return;

  try {
    const retry = await retryLatestFailedCustomerEmailForPolicy({
      policyId: input.policyId,
      templateKey: 'TRAVEL_QUOTE_STANDARD',
    });
    if (retry.status === 'REQUEUED') {
      logger.info(
        { event: 'travel.quote.auto_send.requeued', policyId: input.policyId, messageId: retry.messageId },
        'travel.quote.auto_send.requeued',
      );
      return;
    }
    if (retry.status === 'MAX_ATTEMPTS') {
      logger.warn(
        { event: 'travel.quote.auto_send.max_attempts', policyId: input.policyId, messageId: retry.messageId },
        'travel.quote.auto_send.max_attempts',
      );
      return;
    }
    const result = await sendRevisedQuoteUseCase({
      policyId: input.policyId,
      actor: { id: 'travel-rate-service', role: 'SYSTEM', name: 'Travel rating' },
      correlationId: input.correlationId,
      publicAppBaseUrl: resolvePublicAppBaseUrlFromTenant(),
      auditSource: 'travel-auto-rate',
      quoteWizardStep: 'options',
      // The canonical communications trigger deduplicates a queued delivery
      // by this stable key. A pre-queue failure leaves no delivery record, so
      // a later rate can safely retry without sending duplicates.
      idempotencySeed: 'travel-auto-quote',
    });
    if (!result.ok) {
      logger.warn(
        {
          event: 'travel.quote.auto_send.skipped',
          policyId: input.policyId,
          code: result.code,
          message: result.message,
          correlationId: input.correlationId,
        },
        'travel.quote.auto_send.skipped',
      );
      return;
    }
    logger.info(
      {
        event: 'travel.quote.auto_send.queued',
        policyId: input.policyId,
        recipient: result.recipient,
        messageId: result.messageId,
        correlationId: input.correlationId,
      },
      'travel.quote.auto_send.queued',
    );
  } catch (err) {
    logger.warn(
      { err, policyId: input.policyId, correlationId: input.correlationId },
      'travel.quote.auto_send.failed',
    );
  }
}
