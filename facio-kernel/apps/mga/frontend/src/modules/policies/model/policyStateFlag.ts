export const USE_POLICY_STATE = String(import.meta.env.VITE_USE_POLICY_STATE || '')
  .trim()
  .toLowerCase() === 'true';

export function policyDisplayStatus<T extends { status?: unknown; bo_status?: unknown }>(record: T): string {
  if (!USE_POLICY_STATE) return String(record?.status || '');
  return String(record?.bo_status || record?.status || '');
}
