/**
 * Centralizes policy status display labels so BO/client surfaces and filters
 * never leak lifecycle enums directly into the UI.
 */
export function humanizePolicyStatus(rawStatus: string): string {
  const up = String(rawStatus || '').trim().toUpperCase();
  if (!up) return '—';
  if (up === 'AWAITING_PAYMENT') return 'Awaiting payment';
  if (up === 'INFO_REQUIRED') return 'Info required';
  if (up === 'REFERRAL') return 'Referral';
  if (up === 'INTAKE') return 'Intake';
  if (up === 'DRAFT') return 'Draft';
  if (up === 'QUOTED' || up === 'QUOTE') return 'Quoted';
  if (up === 'BOUND' || up === 'BOUND_DRAFT_ISSUED') return 'Bound';
  if (up === 'ISSUED') return 'Issued';
  if (up === 'ACTIVE') return 'Active';
  if (up === 'DECLINED') return 'Declined';
  if (up === 'CANCELLATION_REQUESTED') return 'Cancellation requested';
  if (up === 'ENDORSEMENT_IN_PROGRESS') return 'Endorsement in progress';
  if (up === 'RENEWAL_IN_PROGRESS') return 'Renewal in progress';
  if (up === 'CANCELLED' || up === 'CANCELED') return 'Cancelled';
  if (up === 'EXPIRED') return 'Expired';
  return up
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getPolicyDocumentTypeLabel(rawType: string): string {
  const type = String(rawType || '').trim().toUpperCase();
  if (!type) return 'Document';
  if (type.endsWith('_ENDORSEMENT_SCHEDULE_PDF')) return 'Endorsement';
  if (type.endsWith('_SCHEDULE_PDF')) return 'Schedule';
  if (type.endsWith('_CERTIFICATE_PDF')) return 'Certificate';
  if (type.endsWith('_STATEMENT_OF_FACT_PDF')) return 'Statement of Fact';
  if (type.endsWith('_GREEN_CARD_PDF')) return 'Green Card';
  if (type.endsWith('_IPID_PDF')) return 'IPID';
  if (type.endsWith('_POLICY_WORDING_PDF') || type.endsWith('_WORDING_PDF')) return 'Policy Wording';
  if (type.endsWith('_EUROP_ASSISTANCE_PDF')) return 'Europ Assistance';
  if (type.includes('CERTIFICATE')) return 'Certificate';
  if (type.includes('STATEMENT_OF_FACT')) return 'Statement of Fact';
  if (type.includes('IPID')) return 'IPID (Key Facts)';
  if (type.includes('GREEN_CARD')) return 'Green Card';
  return type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getPaymentTransactionStatusLabel(rawStatus: string): string {
  const status = String(rawStatus || '').trim().toUpperCase();
  if (!status) return '—';
  if (status === 'PAID') return 'Paid';
  if (status === 'CAPTURED') return 'Captured';
  if (status === 'AUTHORIZED') return 'Authorized';
  if (status === 'FAILED') return 'Failed';
  if (status === 'CANCELLED' || status === 'CANCELED') return 'Cancelled';
  if (status === 'CREDIT_CREATED') return 'Credit created';
  if (status === 'PENDING') return 'Pending';
  if (status === 'OPEN') return 'Open';
  if (status === 'SENT') return 'Sent';
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getPaymentTransactionTypeLabel(rawType: string): string {
  const type = String(rawType || '').trim().toUpperCase();
  if (!type) return '—';
  if (type === 'CHARGE') return 'Charge';
  if (type === 'REFUND') return 'Refund';
  if (type === 'CREDIT') return 'Credit';
  if (type === 'ADJUSTMENT') return 'Adjustment';
  return type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getPaymentProviderLabel(rawProvider: string): string {
  const provider = String(rawProvider || '').trim().toUpperCase();
  if (!provider) return '—';
  if (provider === 'CARDCORP') return 'CardCorp';
  return provider
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getReconciliationStatusLabel(rawStatus: string): string {
  const status = String(rawStatus || '').trim().toUpperCase();
  if (!status) return '—';
  if (status === 'DISCREPANCY') return 'Discrepancy';
  if (status === 'UNAPPLIED') return 'Unapplied';
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
