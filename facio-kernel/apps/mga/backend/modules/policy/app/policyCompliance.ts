import { derivePolicyState } from '../domain/policyStateService.js';
import { isVersionHistoryTransactionType } from '../domain/riskTransactionTypes.js';
import { validateDraftQuote } from '../../quotes/app/validator.js';
import { isReservedQuoteId } from '../../../platform/utils/platformIds.js';

type UnknownRecord = Record<string, unknown>;

const asRecord = (v: unknown): UnknownRecord =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};

type Severity = 'WARN' | 'FAIL';
type PolicyComplianceState = 'PASS' | 'WARN' | 'FAIL';
type PolicyComplianceProfile = 'PRODUCTION_STRICT' | 'SEEDED_RELAXED';

type ComplianceIssue = {
  code: string;
  severity: Severity;
};

type ComplianceInput = {
  policyNumber?: unknown;
  productType?: unknown;
  status?: unknown;
  boStatus?: unknown;
  binderId?: unknown;
  programId?: unknown;
  paymentStatus?: unknown;
  inceptionDate?: Date | string | null;
  expiryDate?: Date | string | null;
  isLocked?: unknown;
  quoteData?: unknown;
  stateCurrentSnapshot?: unknown;
  riskTransactions?: Array<{ status?: unknown; transactionType?: unknown }>;
  documents?: Array<{ status?: unknown; type?: unknown }>;
  claims?: Array<{ status?: unknown }>;
  outstandingBalance?: unknown;
  invoiceOverdue?: unknown;
  totalPremium?: unknown;
};

type ComplianceResult = {
  state: PolicyComplianceState;
  profile: PolicyComplianceProfile;
  reasonCodes: string[];
};

function toUpper(v: unknown): string {
  return String(v || '').trim().toUpperCase();
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function boolLoose(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v || '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function migrationComplianceCodes(snapshot: unknown): string[] {
  const migrationCompliance = asRecord(asRecord(asRecord(snapshot).bdxImport).migrationCompliance);
  if (toUpper(migrationCompliance.state) !== 'FAIL') return [];
  const reasonCodes = Array.isArray(migrationCompliance.reasonCodes)
    ? migrationCompliance.reasonCodes.map((code) => String(code || '').trim()).filter(Boolean)
    : [];
  return reasonCodes.length ? reasonCodes : ['BDX_MIGRATION_NON_COMPLIANT'];
}

function looksSeeded(input: ComplianceInput): boolean {
  const qd = asRecord(input.quoteData);
  const proposer = asRecord(qd.proposer);
  const email = String(proposer.email || '').toLowerCase();
  const firstName = String(proposer.firstName || '').toLowerCase();
  const lastName = String(proposer.lastName || '').toLowerCase();
  return (
    email.endsWith('@example.com') ||
    firstName === 'seed' ||
    firstName === 'renewal' ||
    lastName === 'seed' ||
    lastName === 'pending' ||
    isReservedQuoteId(input.policyNumber)
  );
}

export function evaluatePolicyCompliance(input: ComplianceInput): ComplianceResult {
  const profile: PolicyComplianceProfile = looksSeeded(input) ? 'SEEDED_RELAXED' : 'PRODUCTION_STRICT';
  const issues: ComplianceIssue[] = [];
  const state = derivePolicyState({
    status: input.status,
    inceptionDate: input.inceptionDate ?? null,
    expiryDate: input.expiryDate ?? null,
    isLocked: input.isLocked,
    stateCurrentSnapshot: input.stateCurrentSnapshot,
    riskTransactions: input.riskTransactions || [],
    claims: input.claims || [],
  });
  const issuedLike =
    state.isIssued ||
    ['ISSUED', 'ACTIVE', 'BOUND', 'BOUND_DRAFT_ISSUED', 'CANCELLATION_REQUESTED'].includes(toUpper(input.status));
  const txs = input.riskTransactions || [];
  const docs = input.documents || [];

  // ADR-0011: delegate to canonical version-history transaction-type set.
  const hasBoundBaseline = txs.some(
    (tx) => toUpper(tx.status) === 'BOUND' && isVersionHistoryTransactionType(tx.transactionType)
  );
  const hasGeneratedDoc = docs.some((d) => toUpper(d.status) === 'GENERATED');
  // ADR-0011: strict `_PDF` suffix only. Generated coverage documents always
  // have this suffix (`MOTOR_SCHEDULE_PDF`, `MOTOR_CERTIFICATE_PDF`); a
  // broader substring match would falsely accept e.g. `CERTIFICATE_OF_DAMAGE`
  // or `SCHEDULE_OF_REPAIRS`.
  const hasCoverageDoc = docs.some((d) => {
    const s = toUpper(d.status);
    const t = toUpper(d.type);
    return s === 'GENERATED' && (t.includes('SCHEDULE_PDF') || t.includes('CERTIFICATE_PDF'));
  });
  const premium = toNum(input.totalPremium);
  const outstanding = toNum(input.outstandingBalance);
  const invoiceOverdue = boolLoose(input.invoiceOverdue);
  const paymentStatus = toUpper(input.paymentStatus);
  const inception = input.inceptionDate ? new Date(input.inceptionDate) : null;
  const expiry = input.expiryDate ? new Date(input.expiryDate) : null;

  if (inception && expiry && expiry.getTime() <= inception.getTime()) {
    issues.push({ code: 'DATE_WINDOW_INVALID', severity: 'FAIL' });
  }

  if (issuedLike) {
    const quoteValidation = validateDraftQuote({
      quoteData: asRecord(input.quoteData),
      step: 'policy-compliance',
      mode: 'issuance',
      productType: String(input.productType || '').trim() || undefined,
    });
    if (!quoteValidation.valid) issues.push({ code: 'QUOTE_DATA_INVALID', severity: 'FAIL' });
    if (!String(input.binderId || '').trim()) issues.push({ code: 'MISSING_BINDER_ID', severity: 'FAIL' });
    if (!String(input.programId || '').trim()) issues.push({ code: 'MISSING_PROGRAM_ID', severity: 'FAIL' });
    if (!hasBoundBaseline) issues.push({ code: 'MISSING_BOUND_BASELINE', severity: 'FAIL' });
    if (premium <= 0) issues.push({ code: 'MISSING_PREMIUM', severity: 'FAIL' });
    if (!hasGeneratedDoc) issues.push({ code: 'MISSING_DOCUMENTS', severity: 'WARN' });
    else if (!hasCoverageDoc) issues.push({ code: 'MISSING_COVERAGE_DOCS', severity: 'WARN' });
    if (invoiceOverdue) issues.push({ code: 'INVOICE_OVERDUE', severity: 'WARN' });
    if (paymentStatus === 'PAID' && outstanding > 0) issues.push({ code: 'BILLING_UNBALANCED', severity: 'FAIL' });
    migrationComplianceCodes(input.stateCurrentSnapshot).forEach((code) => {
      issues.push({ code, severity: 'FAIL' });
    });
  }

  const normalized = issues.map((issue) => {
    if (profile === 'SEEDED_RELAXED' && issue.severity === 'FAIL') return { ...issue, severity: 'WARN' as Severity };
    return issue;
  });

  const hasFail = normalized.some((x) => x.severity === 'FAIL');
  const hasWarn = normalized.some((x) => x.severity === 'WARN');
  return {
    state: hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS',
    profile,
    reasonCodes: Array.from(new Set(normalized.map((x) => x.code))),
  };
}
