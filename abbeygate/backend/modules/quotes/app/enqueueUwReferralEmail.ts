import type { Prisma } from '@prisma/client';

import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { logger } from '../../../platform/utils/logger.js';

/**
 * Legacy flat EMAIL.UW_REFERRAL outbox producer (Motor call site).
 *
 * Flat payload: `policyId` / `reasons` at the top level. The worker
 * handler (`backend/workers/handlers/EMAIL.UW_REFERRAL.ts`) accepts BOTH
 * this flat shape and the canonical DomainEventEnvelope; the generic
 * rating spine (`quoteRateService.ts`) emits the envelope in-transaction
 * via `appendDomainEvent` so BEHAVIOR.NORMALIZE can ingest the row —
 * only Motor's `rateQuote` chokepoint still enqueues through this helper.
 *
 * Recipient routing lives in the worker: `UW_REFERRAL_EMAILS_BY_COUNTRY`
 * (tenantConfig) resolved from the policy's operating tenant — not env vars.
 *
 * Best-effort: a failed outbox write must never break rating.
 */
export type UwReferralEmailInput = {
  policyId: string;
  policyNumber?: string | null;
  quoteReference?: string | null;
  reasons?: string[];
};

type UwReferralOutboxPayload = {
  policyId: string;
  reasons: string[];
  policyNumber?: string;
  quoteReference?: string;
};

export function extractUwReferralReasons(source: unknown): string[] {
  const record = parseRecord(source);
  const reasons: string[] = [];

  const triggers = Array.isArray(record.triggers) ? record.triggers : [];
  for (const trigger of triggers) {
    const t = parseRecord(trigger);
    const message = String(t.message || t.code || '').trim();
    if (message) reasons.push(message);
  }

  const rawReasons = Array.isArray(record.reasons) ? record.reasons : [];
  for (const reason of rawReasons) {
    if (typeof reason === 'string') {
      const message = reason.trim();
      if (message) reasons.push(message);
      continue;
    }
    const r = parseRecord(reason);
    const message = String(r.message || r.code || '').trim();
    if (message) reasons.push(message);
  }

  const uwDecision = parseRecord(record.uwDecision);
  if (Object.keys(uwDecision).length) {
    for (const nested of extractUwReferralReasons(uwDecision)) {
      reasons.push(nested);
    }
  }

  return Array.from(new Set(reasons));
}

export async function enqueueUwReferralEmail(input: UwReferralEmailInput): Promise<void> {
  const policyId = String(input.policyId || '').trim();
  if (!policyId) return;

  const reasons = Array.isArray(input.reasons)
    ? input.reasons.map((r) => String(r || '').trim()).filter(Boolean)
    : [];
  const referralPayload: UwReferralOutboxPayload = { policyId, reasons };
  const policyNumber = String(input.policyNumber || '').trim();
  const quoteReference = String(input.quoteReference || '').trim();
  if (policyNumber) referralPayload.policyNumber = policyNumber;
  if (quoteReference) referralPayload.quoteReference = quoteReference;

  try {
    const outboxData: Prisma.OutboxUncheckedCreateInput = {
      operatingTenantId: getTenantConfig().id,
      eventType: 'EMAIL.UW_REFERRAL',
      aggregateId: policyId,
      payload: referralPayload as Prisma.InputJsonValue,
    };
    await tenantScopedPrisma.outbox.create({ data: outboxData });
    logger.info(
      { policyId, policyNumber: policyNumber || null, reasonCount: reasons.length },
      'email.uw_referral.enqueued',
    );
  } catch (err) {
    logger.warn({ err, policyId }, 'email.uw_referral.enqueue_failed');
  }
}
