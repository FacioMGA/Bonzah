export type LifecycleStatus =
  | 'DRAFT'
  | 'INTAKE'
  | 'REFERRAL'
  | 'INFO_REQUIRED'
  | 'QUOTED'
  | 'AWAITING_PAYMENT'
  | 'AWAITING_EXTERNAL_ISSUANCE'
  | 'BOUND'
  | 'BOUND_DRAFT_ISSUED'
  | 'ISSUED'
  | 'ACTIVE'
  | 'DECLINED'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED'
  | 'EXPIRED';

export function resolveLifecycleStatus(
  raw: unknown,
  dates?: { inceptionDate?: Date | string | null; expiryDate?: Date | string | null }
): LifecycleStatus {
  const s = String(raw || '').trim().toUpperCase();

  // Canonical and well-known statuses — pass through directly
  if (!s) return 'DRAFT';
  // Spelling variants and renamed statuses (tolerated at the input boundary)
  if (s === 'DATA_CAPTURE_IN_PROGRESS') return 'INTAKE';
  if (s === 'REFERRED') return 'REFERRAL';
  if (s === 'PAYMENT_FAILED') return 'AWAITING_PAYMENT';
  if (s === 'DRAFT') return 'DRAFT';
  if (s === 'INTAKE') return 'INTAKE';
  if (s === 'REFERRAL') return 'REFERRAL';
  if (s === 'INFO_REQUIRED') return 'INFO_REQUIRED';
  if (s === 'QUOTED') return 'QUOTED';
  if (s === 'AWAITING_PAYMENT') return 'AWAITING_PAYMENT';
  if (s === 'AWAITING_EXTERNAL_ISSUANCE') return 'AWAITING_EXTERNAL_ISSUANCE';
  if (s === 'BOUND') return 'BOUND';
  if (s === 'BOUND_DRAFT_ISSUED') return 'BOUND_DRAFT_ISSUED';
  if (s === 'DECLINED') return 'DECLINED';
  if (s === 'CANCELLATION_REQUESTED') return 'CANCELLATION_REQUESTED';
  if (s === 'CANCELLED' || s === 'CANCELED') return 'CANCELLED';
  if (s === 'EXPIRED') return 'EXPIRED';

  // ISSUED and ACTIVE are both valid DB values; derive the precise lifecycle position from dates.
  if (s === 'ISSUED' || s === 'ACTIVE') {
    const now = new Date();
    const start = dates?.inceptionDate ? new Date(dates.inceptionDate) : null;
    const end = dates?.expiryDate ? new Date(dates.expiryDate) : null;
    if (end && now > end) return 'EXPIRED';
    if (start && now < start) return 'ISSUED';
    return 'ACTIVE';
  }

  // Fallback to safest pre-bind state
  return 'INTAKE';
}
