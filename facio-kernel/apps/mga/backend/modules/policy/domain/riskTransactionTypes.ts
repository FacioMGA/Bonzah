export const ISSUANCE_TRANSACTION_TYPES = ['INCEPTION'] as const;
export const POLICY_CHANGE_TRANSACTION_TYPES = ['ENDORSEMENT'] as const;
export const VERSION_HISTORY_TRANSACTION_TYPES = ['INCEPTION', 'ENDORSEMENT'] as const;

function toUpper(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

export function isRenewalTransactionType(value: unknown): boolean {
  return toUpper(value) === 'RENEWAL';
}

export function isEndorsementTransactionType(value: unknown): boolean {
  return toUpper(value) === 'ENDORSEMENT';
}

export function isPolicyChangeTransactionType(value: unknown): boolean {
  return POLICY_CHANGE_TRANSACTION_TYPES.includes(toUpper(value) as (typeof POLICY_CHANGE_TRANSACTION_TYPES)[number]);
}

export function isIssuanceTransactionType(value: unknown): boolean {
  return ISSUANCE_TRANSACTION_TYPES.includes(toUpper(value) as (typeof ISSUANCE_TRANSACTION_TYPES)[number]);
}

export function isVersionHistoryTransactionType(value: unknown): boolean {
  return VERSION_HISTORY_TRANSACTION_TYPES.includes(
    toUpper(value) as (typeof VERSION_HISTORY_TRANSACTION_TYPES)[number]
  );
}
