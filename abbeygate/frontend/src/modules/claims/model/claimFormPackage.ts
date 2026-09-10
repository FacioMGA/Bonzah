import { asRecord } from '@/src/shared/lib/record';
function statusNorm(status: unknown): string {
  return String(status || '').toUpperCase().replace(/\s+/g, '_');
}

export function claimFormPackageStatus(data: unknown): string {
  const pkg = asRecord(asRecord(data).claimFormPackage);
  return statusNorm(pkg.status);
}

export function claimFormPackageStatusLabel(data: unknown): string | null {
  const status = claimFormPackageStatus(data);
  if (!status) return null;
  if (status === 'SENT') return 'Claim form requested';
  if (status === 'OPEN') return 'Awaiting claimant completion';
  if (status === 'COMPLETED') return 'Claim form completed';
  return status;
}

export function fnolSubmitted(data: unknown): boolean {
  const rec = asRecord(data);
  const fnol = asRecord(rec.fnol);
  const claimForm = asRecord(rec.claimForm);
  return Boolean(String(fnol.submittedAt || '').trim() || String(claimForm.submittedAt || '').trim());
}

export function isClientClaimFormVisible(data: unknown): boolean {
  const pkgStatus = claimFormPackageStatus(data);
  return fnolSubmitted(data) && (pkgStatus === 'SENT' || pkgStatus === 'OPEN');
}
