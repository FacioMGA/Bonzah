/**
 * Shared humanizers for claim statuses/codes used by BO and client surfaces.
 */
export function getClaimStatusLabel(rawStatus: string): string {
  const status = String(rawStatus || '').trim().toUpperCase();
  if (!status) return '—';
  if (status === 'CLOSED_THIS_MONTH') return 'Closed this month';
  if (status === 'REOPENED') return 'Re-opened';
  if (status === 'WITHDRAWN') return 'Withdrawn';
  if (status === 'PENDING') return 'Pending';
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function humanizeClaimCode(rawCode: string): string {
  const value = String(rawCode || '').trim();
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\w/, (char) => char.toUpperCase());
}
