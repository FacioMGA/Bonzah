import type {
  BinderClauseReadModel,
  BinderCoverageReadModel,
  BinderDetailBundle,
  BinderDocumentReadModel,
  BinderFinancialsReadModel,
  BinderHealthFlag,
  BinderIndexRow,
  BinderPartyReadModel,
  BinderProgramLinkReadModel,
  BinderPublishResult,
  BinderReportingReadModel,
  BinderSimulationResult,
  BinderSimulationRuleOutcome,
  BinderStatus,
  BinderUsageSummary,
} from './readModels';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return String(value || '').trim();
}

function asNullableString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized ? normalized : null;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStatus(value: unknown): BinderStatus {
  const raw = asString(value).toUpperCase();
  if (raw === 'DRAFT' || raw === 'ACTIVE' || raw === 'SUSPENDED' || raw === 'EXPIRED' || raw === 'ARCHIVED' || raw === 'PENDING') {
    return raw;
  }
  return 'UNKNOWN';
}

function fmtDate(value: string | null): string {
  if (!value) return 'Not set';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Not set';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function effectivePeriodLabel(startDate: string | null, endDate: string | null): string {
  return `${fmtDate(startDate)} - ${fmtDate(endDate)}`;
}

function healthFromStatus(status: BinderStatus): BinderHealthFlag {
  if (status === 'ACTIVE') return 'healthy';
  if (status === 'DRAFT' || status === 'PENDING') return 'warning';
  return 'critical';
}

function mapProgramLink(rowInput: unknown): BinderProgramLinkReadModel {
  const row = asRecord(rowInput);
  return {
    id: asString(row.id),
    status: asString(row.status) || 'UNKNOWN',
    programId: asString(row.programId),
    programName: asNullableString(row.programName || asRecord(row.program).name),
    programStatus: asNullableString(row.programStatus || asRecord(row.program).status),
    mapping: asRecord(row.mapping),
    updatedAt: asNullableString(row.updatedAt),
  };
}

export function mapBinderIndexRows(apiResponse: unknown): BinderIndexRow[] {
  const root = asRecord(apiResponse);
  const rows = asArray(root.data);
  return rows.map((entry): BinderIndexRow => {
    const row = asRecord(entry);
    const status = toStatus(row.status);
    const programLinks = asArray(row.programLinks);
    const config = asRecord(row.config);
    const agreement = asRecord(config.agreement);
    const period = asRecord(agreement.period);
    const scope = asRecord(config.scope);
    const programUsageCount = asNumber(row.programLinkCount) || programLinks.length;
    const startDate = asNullableString(row.startDate || period.inceptionDate);
    const endDate = asNullableString(row.endDate || period.expiryDate);
    const leadCapacityProviderName =
      asString(row.leadCapacityProviderName) || asString(asRecord(agreement.coverholder2).name) || 'Lloyds Insurance Company S.A.';
    const productLabel =
      asString(row.authorizedClass) || asString(scope.authorizedClass) || 'Private Motor Insurance';
    const regionLabel =
      asString(row.regionLabel) || asString(row.scopeLabel) || asString(asArray(scope.riskLocationCountries)[0]) || 'Cyprus';
    const grossPremiumWritten = asNumber(row.grossPremiumWritten);
    const grossPremiumLimit = asNumber(row.grossPremiumLimit);
    const gpiUsagePct = asNullableNumber(row.gpiUsagePct);
    const gpiWarnThresholdPct = asNumber(row.gpiWarnThresholdPct) || 85;
    const hasReportingConfig = Boolean(row.hasReportingConfig);
    const hasMissingConfig = Boolean(row.hasMissingConfig || !startDate || !endDate || !asString(row.umr) || !asString(row.agreementNumber));
    return {
      id: asString(row.id),
      coverholderName: asString(row.coverholderName),
      leadCapacityProviderName,
      productLabel,
      regionLabel,
      umr: asString(row.umr),
      agreementNumber: asString(row.agreementNumber),
      status,
      startDate,
      endDate,
      defaultCurrency: asString(row.defaultCurrency) || 'EUR',
      settlementCurrency: asString(row.settlementCurrency) || 'EUR',
      version: asNumber(row.version),
      lloydsReportingVer: asString(row.lloydsReportingVer) || 'V5.2',
      lastUpdatedAt: asNullableString(row.updatedAt),
      effectivePeriodLabel: effectivePeriodLabel(startDate, endDate),
      healthFlag: healthFromStatus(status),
      publishabilityFlag: status === 'DRAFT' || status === 'PENDING' ? 'publishable' : 'blocked',
      programUsageCount,
      policyCount: asNumber(row.policyCount),
      grossPremiumWritten,
      grossPremiumLimit,
      gpiUsagePct,
      gpiWarnThresholdPct,
      scopeLabel: asString(row.scopeLabel) || regionLabel,
      hasReportingConfig,
      hasMissingConfig,
    };
  });
}

function mapParty(rowInput: unknown): BinderPartyReadModel {
  const row = asRecord(rowInput);
  return {
    id: asString(row.id),
    role: asString(row.role),
    name: asString(row.name),
    registrationNumber: asNullableString(row.registrationNumber),
    partySubtype: asNullableString(row.partySubtype),
    address: asRecord(row.address),
    contact: asRecord(row.contact),
    rolesMeta: asRecord(row.rolesMeta),
  };
}

function mapDocument(rowInput: unknown): BinderDocumentReadModel {
  const row = asRecord(rowInput);
  return {
    id: asString(row.id),
    type: asString(row.type),
    name: asString(row.name),
    filename: asNullableString(row.filename),
    storageUri: asString(row.storageUri),
    mimeType: asNullableString(row.mimeType),
    sizeBytes: asNullableNumber(row.sizeBytes),
    uploadedAt: asNullableString(row.uploadedAt),
    uploadedBy: asNullableString(row.uploadedBy),
    meta: asRecord(row.meta),
  };
}

function mapCoverage(rowInput: unknown): BinderCoverageReadModel {
  const row = asRecord(rowInput);
  return {
    id: asString(row.id),
    coverageCode: asString(row.coverageCode),
    title: asNullableString(row.title),
    allowed: Boolean(row.allowed),
    maxLimit: asRecord(row.maxLimit),
    deductible: asRecord(row.deductible),
    partyLimits: asRecord(row.partyLimits),
    wordingAnchorClauseId: asNullableString(row.wordingAnchorClauseId),
    meta: asRecord(row.meta),
  };
}

function mapClause(rowInput: unknown): BinderClauseReadModel {
  const row = asRecord(rowInput);
  return {
    id: asString(row.id),
    clauseType: asString(row.clauseType),
    textFragment: asString(row.textFragment),
    codes: asArray(row.codes).map((x) => asString(x)).filter(Boolean),
    pointer: asRecord(row.pointer),
    meta: asRecord(row.meta),
  };
}

function mapFinancials(rowInput: unknown): BinderFinancialsReadModel {
  const row = asRecord(rowInput);
  return {
    maxLine: asNullableNumber(row.maxLine),
    grossPremiumLimit: asNullableNumber(row.grossPremiumLimit),
    notifiablePercent: asNullableNumber(row.notifiablePercent),
    commissionRate: asNullableNumber(row.commissionRate),
    profitCommission: asRecord(row.profitCommission),
    premiumAccount: asRecord(row.premiumAccount),
  };
}

function mapReporting(rowInput: unknown): BinderReportingReadModel {
  const row = asRecord(rowInput);
  return {
    writtenRiskSchedule: asNullableString(row.writtenRiskSchedule),
    paidClaimsSchedule: asNullableString(row.paidClaimsSchedule),
    bordereauFormat: asNullableString(row.bordereauFormat),
    destination: asRecord(row.destination),
    reportingContacts: asRecord(row.reportingContacts),
  };
}

export function mapBinderDetailBundle(apiResponse: unknown): BinderDetailBundle | null {
  const root = asRecord(apiResponse);
  const data = asRecord(root.data);
  const binderId = asString(data.id);
  if (!binderId) return null;
  return {
    binder: {
      id: binderId,
      coverholderName: asString(data.coverholderName),
      coverholderPin: asNullableString(data.coverholderPin),
      umr: asString(data.umr),
      agreementNumber: asString(data.agreementNumber),
      lloydsReportingVer: asString(data.lloydsReportingVer) || 'V5.2',
      defaultCurrency: asString(data.defaultCurrency) || 'EUR',
      settlementCurrency: asString(data.settlementCurrency) || 'EUR',
      status: toStatus(data.status),
      startDate: asNullableString(data.startDate),
      endDate: asNullableString(data.endDate),
      version: asNumber(data.version),
      etag: asNullableString(data.etag),
      config: asRecord(data.config),
      createdAt: asNullableString(data.createdAt),
      updatedAt: asNullableString(data.updatedAt),
    },
    parties: asArray(data.parties).map(mapParty),
    documents: asArray(data.documents).map(mapDocument),
    coverages: asArray(data.coverages).map(mapCoverage),
    clauses: asArray(data.clauses).map(mapClause),
    financials: data.financials ? mapFinancials(data.financials) : null,
    reporting: data.reportingConfig ? mapReporting(data.reportingConfig) : null,
    programLinks: asArray(data.programLinks).map(mapProgramLink),
  };
}

export function mapBinderUsageSummary(apiResponse: unknown): BinderUsageSummary {
  const root = asRecord(apiResponse);
  const links = asArray(root.data).map(mapProgramLink);
  return {
    linkedPrograms: links,
    totals: {
      linkedPrograms: links.length,
      activeLinks: links.filter((x) => String(x.status).toUpperCase() === 'ACTIVE').length,
    },
  };
}

export function mapBinderSimulationResult(apiResponse: unknown): BinderSimulationResult {
  const root = asRecord(apiResponse);
  const data = asRecord(root.data);
  const matched = asArray(data.matchedRules).map((entry): BinderSimulationRuleOutcome => {
    const row = asRecord(entry);
    const status = asString(row.status).toLowerCase();
    return {
      ruleCode: asString(row.ruleCode) || 'RULE',
      status: status === 'fail' || status === 'warn' ? status : 'pass',
      message: asString(row.message),
    };
  });
  return {
    pass: Boolean(data.pass),
    authoritative: Boolean(data.authoritative),
    reasons: asArray(data.reasons).map((x) => asString(x)).filter(Boolean),
    matchedRules: matched,
    referralTarget: asNullableString(data.referralTarget),
    evaluatedAt: asString(data.evaluatedAt) || new Date().toISOString(),
    inputs: {
      territory: asNullableString(asRecord(data.inputs).territory),
      riskLocationCountry: asNullableString(asRecord(data.inputs).riskLocationCountry),
      insuredDomicileCountry: asNullableString(asRecord(data.inputs).insuredDomicileCountry),
      vehicleValue: asNullableNumber(asRecord(data.inputs).vehicleValue),
    },
  };
}

export function mapBinderPublishResult(apiResponse: unknown, binderId: string): BinderPublishResult {
  const root = asRecord(apiResponse);
  const data = asRecord(root.data);
  return {
    binderId: asString(data.id) || binderId,
    status: toStatus(data.status || 'ACTIVE'),
    reportingPeriodsCreated: asNumber(data.reportingPeriodsCreated),
    message: asNullableString(data.message),
  };
}
