import type { BinderDetailBundle, BinderIndexRow } from './readModels';

type DerivedStatus = {
  canEdit: boolean;
  canPublish: boolean;
  canSimulate: boolean;
  isUsableForAssignment: boolean;
  isUsableForBind: boolean;
  isExpired: boolean;
  isIncomplete: boolean;
  warnings: string[];
};

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function deriveBinderRowState(row: BinderIndexRow): DerivedStatus {
  const now = new Date();
  const end = toDate(row.endDate);
  const start = toDate(row.startDate);
  const isExpired = Boolean(end && end.getTime() < now.getTime());
  const active = row.status === 'ACTIVE';
  const hasPeriod = Boolean(start && end);
  const isIncomplete = !row.umr || !row.agreementNumber || !row.coverholderName || !hasPeriod;
  const warnings: string[] = [];
  if (isIncomplete) warnings.push('Missing core agreement fields.');
  if (isExpired) warnings.push('Binder agreement period has ended.');
  if (!active) warnings.push('Binder is not active.');
  return {
    canEdit: row.status !== 'ARCHIVED',
    canPublish: row.status === 'DRAFT' || row.status === 'PENDING',
    canSimulate: true,
    isUsableForAssignment: active && !isExpired,
    isUsableForBind: active && !isExpired && !isIncomplete,
    isExpired,
    isIncomplete,
    warnings,
  };
}

export function deriveBinderDetailState(bundle: BinderDetailBundle): DerivedStatus {
  return deriveBinderRowState({
    id: bundle.binder.id,
    coverholderName: bundle.binder.coverholderName,
    leadCapacityProviderName: bundle.binder.coverholderName || 'Lloyds Insurance Company S.A.',
    productLabel: String((bundle.binder.config as Record<string, unknown>).productType || 'Private Motor Insurance'),
    regionLabel: String((bundle.binder.config as Record<string, unknown>).regionLabel || 'Cyprus'),
    umr: bundle.binder.umr,
    agreementNumber: bundle.binder.agreementNumber,
    status: bundle.binder.status,
    startDate: bundle.binder.startDate,
    endDate: bundle.binder.endDate,
    defaultCurrency: bundle.binder.defaultCurrency,
    settlementCurrency: bundle.binder.settlementCurrency,
    version: bundle.binder.version,
    lloydsReportingVer: bundle.binder.lloydsReportingVer,
    lastUpdatedAt: bundle.binder.updatedAt,
    effectivePeriodLabel: '',
    healthFlag: 'healthy',
    publishabilityFlag: 'blocked',
    programUsageCount: bundle.programLinks.length,
    policyCount: 0,
    grossPremiumWritten: 0,
    grossPremiumLimit: 0,
    gpiUsagePct: null,
    gpiWarnThresholdPct: 85,
    scopeLabel: String((bundle.binder.config as Record<string, unknown>).scopeLabel || 'Cyprus'),
    hasReportingConfig: Boolean(bundle.reporting),
    hasMissingConfig: false,
  });
}
