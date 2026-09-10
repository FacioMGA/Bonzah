import { productCatalog } from '@/src/products';

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const fmtDate = (value: unknown) => {
  const d = new Date(String(value || ''));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
};

export const fmtDateTime = (value: unknown) => {
  const d = new Date(String(value || ''));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

/**
 * Canonical document-type -> display-label lookup, merged from every product
 * manifest's `documentTypes` map (the same labels the backend document-pack
 * contracts assert against). Keys are product-scoped doc types
 * (e.g. `HOME_SCHEDULE_PDF`, `MOTOR_CERTIFICATE_PDF`) so the merge is
 * collision-free. This is why a Home schedule shows "Policy Schedule" and not a
 * motor label: shared BO code must render from the manifest, never from a
 * product-literal branch (see tools/quality/check-no-product-literals-in-shared-bo.mjs).
 */
const DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  productCatalog.flatMap((entry) => Object.entries(entry.manifest.documentTypes)),
);

export const toDocName = (value: unknown) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return 'Document';
  const label = DOC_TYPE_LABELS[raw];
  if (label) return label;
  return raw.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
};

export const invoiceStatusClass = (status: string) => {
  if (['PAID', 'SETTLED'].includes(status)) return 'bg-emerald-50 text-emerald-900 border border-emerald-200';
  if (['OVERDUE', 'FAILED', 'CANCELLED'].includes(status)) return 'bg-red-50 text-red-900 border border-red-200';
  return 'bg-amber-50 text-amber-900 border border-amber-200';
};

export const paymentStatusClass = (status: string) => {
  if (['PAID', 'CAPTURED', 'AUTHORIZED'].includes(status)) return 'bg-emerald-50 text-emerald-900 border border-emerald-200';
  if (['FAILED', 'CANCELLED'].includes(status)) return 'bg-red-50 text-red-900 border border-red-200';
  return 'bg-amber-50 text-amber-900 border border-amber-200';
};

export const buildPolicyNumberMap = (policies: unknown[]) =>
  new Map<string, string>(
    policies
      .map((item) => asRecord(item))
      .map((p) => [String(p.id || '').trim(), String(p.policyNumber || '').trim()] as const)
      .filter(([id, policyNumber]) => Boolean(id) && Boolean(policyNumber))
  );
