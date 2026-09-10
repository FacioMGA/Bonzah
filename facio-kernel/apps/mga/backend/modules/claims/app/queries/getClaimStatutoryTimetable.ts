import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import {
  resolveJurisdictionProductConfig,
  ProductConfigurationError,
} from '../../../jurisdiction/domain/productConfiguration.js';
import { buildClaimWorksheetProjection } from '../../domain/worksheetProjection.js';
import { computeStatutoryTimetable, type StatutoryTimetable } from '../../domain/statutoryTimetable.js';

/**
 * Read-only, derived statutory claims-handling timetable for a single claim.
 *
 * The timetable is NOT stored state — it is recomputed on every read from the
 * claim worksheet projection plus the jurisdiction's `claimsHandling` config
 * (canonical owner: `JurisdictionProductConfig`). This keeps the operational
 * clock honest: it always reflects the current legal values and the current
 * claim facts, and there is nothing to migrate when a deadline value changes.
 *
 * Deadlines only exist for jurisdictions/products that declare a
 * `claimsHandling.nonFaultMotor` block (today: PT/MOTOR, DL 291/2007). Every
 * other claim resolves to `applicable: false` — that absence is the answer,
 * not an error.
 */

export type ClaimStatutoryTimetableResult =
  | {
      applicable: false;
      reason: 'no_product' | 'jurisdiction_unresolved' | 'no_statutory_timetable';
      countryCode?: string;
      productCode?: string;
    }
  | {
      applicable: true;
      anchored: false;
      regulatoryReference: string;
      countryCode: string;
      productCode: string;
    }
  | {
      applicable: true;
      anchored: true;
      countryCode: string;
      productCode: string;
      timetable: StatutoryTimetable;
    };

/**
 * Returns `null` only when the claim does not exist (so the HTTP layer can 404).
 * A claim that exists but has no statutory timetable resolves to
 * `{ applicable: false, ... }`.
 */
export async function getClaimStatutoryTimetable(
  claimId: string,
): Promise<ClaimStatutoryTimetableResult | null> {
  const claim = await tenantScopedPrisma.claim.findUnique({
    where: { id: claimId },
    include: {
      policy: { include: { binder: true } },
      events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
    },
  });
  if (!claim) return null;

  // Product is owned by the linked policy (single source). An unlinked claim
  // has no product and therefore no statutory timetable.
  const productCode = String(claim.policy?.productType ?? '').trim();
  if (!productCode) {
    return { applicable: false, reason: 'no_product' };
  }

  let config: ReturnType<typeof resolveJurisdictionProductConfig>;
  try {
    config = resolveJurisdictionProductConfig({
      productCode,
      binder: claim.policy?.binder
        ? { id: claim.policy.binder.id, config: claim.policy.binder.config }
        : null,
      tenant: getTenantConfig(),
      source: claim.lossCountry ? { countryCode: claim.lossCountry } : undefined,
    });
  } catch (error) {
    if (error instanceof ProductConfigurationError) {
      return { applicable: false, reason: 'jurisdiction_unresolved', productCode };
    }
    throw error;
  }

  const handling = config.claimsHandling;
  const deadlines = handling?.nonFaultMotor;
  if (!handling || !deadlines) {
    return {
      applicable: false,
      reason: 'no_statutory_timetable',
      countryCode: config.countryCode,
      productCode: config.productCode,
    };
  }

  // certificateReference is a display-only projection field we do not read
  // here (the timetable needs only firstNotifiedAt + the event stream), so we
  // pass an empty string rather than reaching into the claim JSON blob.
  const projection = buildClaimWorksheetProjection({
    claimId: claim.id,
    claimReference: claim.claimNumber,
    certificateReference: '',
    events: claim.events,
  });

  // Statutory anchor = the moment the responsible third-party insurer first
  // received notification. We do not invent it: absent a first-notification
  // timestamp the clock has not started (per `no-defensive-fallbacks`).
  const anchorIso = projection.firstNotifiedAt;
  if (!anchorIso) {
    return {
      applicable: true,
      anchored: false,
      regulatoryReference: handling.regulatoryReference,
      countryCode: config.countryCode,
      productCode: config.productCode,
    };
  }

  // Optional workflow signals derived from the immutable event stream. Only
  // the complaint-response clock has a canonical worksheet event today
  // (COMPLAINT_RECEIVED); liability/payment/DAAA/dismantling are surfaced as
  // "not started" until their capture points exist (later phase).
  const complaintEvent = projection.timeline.find(
    (event) => String(event.eventType).toUpperCase() === 'COMPLAINT_RECEIVED',
  );

  const timetable = computeStatutoryTimetable({
    deadlines,
    regulatoryReference: handling.regulatoryReference,
    anchorDate: new Date(anchorIso),
    formalComplaintSentAt: complaintEvent ? new Date(complaintEvent.occurredAt) : null,
    now: new Date(),
  });

  return {
    applicable: true,
    anchored: true,
    countryCode: config.countryCode,
    productCode: config.productCode,
    timetable,
  };
}
