/**
 * loadFnolLinkDeliveryStatus.ts — canonical read for the actual worker
 * delivery state of a claim's FNOL intake link email (ABY-268).
 *
 * Why this exists
 * ----------------
 * The `SEND_FNOL_LINK` claim-worksheet command stamps `sentAt = now` the
 * moment the customer-email trigger is *queued* (status `QUEUED` on the
 * `communication_messages` table). Actual SMTP delivery happens later
 * via the `COMMUNICATION_OUTBOUND` worker, which transitions the row to
 * `SENT` / `DELIVERED` / `FAILED` and writes a
 * `CommunicationDeliveryAttempt` row per attempt.
 *
 * Before this helper, the Claim Summary tab read the `FNOL_LINK_SENT`
 * worksheet event and rendered "FNOL email sent to …" as if that were
 * authoritative. Customers reported "it shows sent but I never got it"
 * (ABY-260 / ABY-270). This reader queries the actual message row so
 * the operator UI can speak truth (`QUEUED` / `SENT` / `DELIVERED` /
 * `FAILED`) instead of asserting delivery on every queue.
 *
 * Contract spine
 * --------------
 * - The FNOL link is dispatched via `dispatchCustomerEmailTrigger` with
 *   `trigger: 'CLAIMS_FNOL_LINK'`, `entityType: 'CLAIM'`. The
 *   `customer-email-trigger-service` persists the trigger as
 *   `externalRefs.template.templateId = 'CLAIMS_FNOL_LINK'` on the
 *   resulting `communication_messages` row.
 * - This reader narrows by exactly that key. Adding a new FNOL-link
 *   template variant means adding the new template-id to
 *   `FNOL_LINK_TEMPLATE_IDS` below — there is no other extension point.
 */

import { tenantScopedPrisma } from '../../../platform/db/connection.js';

/**
 * Template id on `externalRefs.template.templateId` that counts as a
 * FNOL intake link email. Single value because the Prisma JSON-path
 * filter operator we use (`equals`) is a 1:1 match. If a second
 * template ships (e.g. localized variant) the simplest extension is
 * to OR over multiple `equals` clauses inside the `where`.
 */
export const FNOL_LINK_TEMPLATE_ID = 'CLAIMS_FNOL_LINK' as const;

/**
 * Status the operator UI cares about. Map of the underlying
 * `CommunicationMessage.status` enum (`QUEUED | SENDING | SENT |
 * DELIVERED | FAILED`) onto a smaller customer-facing set:
 *
 *   - `QUEUED`   — accepted by us, worker has not yet attempted
 *                  delivery, OR worker is currently attempting
 *   - `SENT`     — provider accepted the message (no delivery webhook
 *                  yet) OR `DELIVERED` (provider confirmed receipt)
 *   - `FAILED`   — worker exhausted retries (`MAX_DELIVERY_ATTEMPTS`)
 *                  or the dispatcher itself refused (e.g. missing
 *                  variables, no template mapping)
 *   - `UNKNOWN`  — no message row exists yet (e.g. the
 *                  `SEND_FNOL_LINK` worksheet command was issued but
 *                  the unified-email dispatch returned `skipped: true`
 *                  before persistence happened)
 *
 * `SENDING` collapses into `QUEUED` deliberately — from the operator's
 * perspective the message is still in flight and they should not be
 * told it has been sent yet.
 */
export type FnolLinkDeliveryStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'UNKNOWN';

export interface FnolLinkDelivery {
  status: FnolLinkDeliveryStatus;
  recipient: string | null;
  /** When the message row was created (i.e. when we queued it). */
  queuedAt: string | null;
  /** When the worker reported provider acceptance (status === SENT). */
  sentAt: string | null;
  /** When the provider confirmed inbox delivery (status === DELIVERED). */
  deliveredAt: string | null;
  /** Latest delivery-attempt error code, if any. */
  errorCode: string | null;
  /** Latest delivery-attempt error detail, if any. */
  errorDetail: string | null;
  /** Total attempts the worker has made against this message. */
  attemptCount: number;
  /** Underlying `CommunicationMessage.id` for cross-references. */
  messageId: string | null;
}

const UNKNOWN_DELIVERY: FnolLinkDelivery = {
  status: 'UNKNOWN',
  recipient: null,
  queuedAt: null,
  sentAt: null,
  deliveredAt: null,
  errorCode: null,
  errorDetail: null,
  attemptCount: 0,
  messageId: null,
};

function classify(raw: string | null | undefined): FnolLinkDeliveryStatus {
  const upper = String(raw || '').toUpperCase();
  if (upper === 'DELIVERED' || upper === 'SENT') return 'SENT';
  if (upper === 'FAILED') return 'FAILED';
  if (upper === 'QUEUED' || upper === 'SENDING') return 'QUEUED';
  return 'UNKNOWN';
}

function firstRecipient(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) return entry.trim();
    }
    return null;
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/**
 * Returns the actual delivery state of the most-recent FNOL intake
 * link email for the supplied claim, or `UNKNOWN` if no message row
 * has been queued yet.
 *
 * Reads via `tenantScopedPrisma` — the caller is expected to be inside
 * the operating-tenant ALS scope (every claims-router handler is).
 */
export async function loadFnolLinkDeliveryStatus(claimId: string): Promise<FnolLinkDelivery> {
  if (!claimId) return UNKNOWN_DELIVERY;

  const message = await tenantScopedPrisma.communicationMessage.findFirst({
    where: {
      thread: { entityType: 'CLAIM', entityId: claimId },
      direction: 'OUTBOUND',
      channel: 'EMAIL',
      // `externalRefs.template.templateId` matches the trigger key set
      // by `customerEmailTriggerService.execute` — see
      // `FNOL_LINK_TEMPLATE_ID` for the canonical key.
      externalRefs: {
        path: ['template', 'templateId'],
        equals: FNOL_LINK_TEMPLATE_ID,
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      sentAt: true,
      deliveredAt: true,
      createdAt: true,
      toRecipients: true,
      deliveryAttempts: {
        orderBy: { attemptedAt: 'desc' },
        select: { errorCode: true, errorDetail: true },
        take: 1,
      },
      _count: { select: { deliveryAttempts: true } },
    },
  });

  if (!message) return UNKNOWN_DELIVERY;

  const status = classify(message.status);
  const latestAttempt = message.deliveryAttempts[0];
  return {
    status,
    recipient: firstRecipient(message.toRecipients),
    queuedAt: message.createdAt ? message.createdAt.toISOString() : null,
    sentAt: message.sentAt ? message.sentAt.toISOString() : null,
    deliveredAt: message.deliveredAt ? message.deliveredAt.toISOString() : null,
    errorCode: latestAttempt?.errorCode ?? null,
    errorDetail: latestAttempt?.errorDetail ?? null,
    attemptCount: message._count.deliveryAttempts,
    messageId: message.id,
  };
}
