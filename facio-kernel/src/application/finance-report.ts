import { createHash } from 'node:crypto';
import type { Scope } from '../contracts/configuration.js';
import type { FinanceJournal, FinanceLedger } from '../contracts/finance.js';
import {
  financialReportSchema,
  type FinancialReportInput,
  type FinancialReport,
} from '../contracts/finance-report.js';
import { minorUnitSchema } from '../contracts/money.js';
import type { Store } from '../storage/store.js';
import { hash, KernelError } from '../domain/canonical.js';

const minor = (value: bigint) => {
  const result = value.toString();
  if (!minorUnitSchema.safeParse(result).success)
    throw new KernelError(
      'MONEY_OVERFLOW',
      'As-of report total exceeds supported exact-money magnitude',
      422,
    );
  return result;
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const net = (journals: FinanceJournal[], account: FinanceJournal['lines'][number]['account']) =>
  journals
    .flatMap((journal) => journal.lines)
    .filter((line) => line.account === account)
    .reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n);
const totals = (journals: FinanceJournal[]) => ({
  externalPremiumMinor: minor(net(journals, 'external_premium')),
  commissionAccruedMinor: minor(-net(journals, 'commission_income')),
  commissionReceivedMinor: minor(net(journals, 'recorded_commission_cash')),
  commissionOutstandingMinor: minor(net(journals, 'commission_receivable')),
});
const postedCapacity = (journals: FinanceJournal[]) => {
  const values = new Map<string, bigint>();
  for (const line of journals
    .flatMap((journal) => journal.lines)
    .filter((line) => line.account === 'external_capacity'))
    values.set(
      line.partyId,
      (values.get(line.partyId) ?? 0n) + BigInt(line.creditMinor) - BigInt(line.debitMinor),
    );
  return values;
};

/** Caller supplies the trusted scope and holds the canonical read transaction. No current-head totals are substituted for historical facts. */
export function financialReport(
  store: Store,
  scope: Scope,
  input: FinancialReportInput,
  readLedger: (scope: Scope, recordId: string) => FinanceLedger,
): FinancialReport {
  const recordedAsOf = new Date(input.recordedAsOf).toISOString();
  const recordedCutoff = Date.parse(recordedAsOf);
  const listing = input.recordId
    ? { records: [store.insuranceRead(scope, input.recordId)], hasMore: false }
    : store.insuranceList(scope);
  if (listing.hasMore)
    throw new KernelError(
      'FINANCE_REPORT_LIMIT',
      'The authorized scope exceeds 100 records; choose an exact record until paginated reporting is available',
      422,
    );
  const records: FinancialReport['records'] = [],
    journals: FinancialReport['journals'] = [];
  for (const current of [...listing.records].sort((a, b) => compare(a.id, b.id))) {
    const history = store.insuranceHistory(scope, current.id);
    const eligible = history.revisions.filter(
      (revision, index) =>
        revision.status !== 'quoted' &&
        Date.parse(history.events[index]!.createdAt) <= recordedCutoff &&
        (history.events[index]!.effectiveDate ?? revision.quote.term.startDate) <=
          input.effectiveAsOf,
    );
    const selected = eligible.at(-1);
    if (!selected || selected.status === 'quoted') continue;
    const event = history.events[selected.version - 1]!;
    // The ledger reader validates the complete retained chain and cross-record receipt allocation first.
    const ledger = readLedger(scope, current.id);
    const entries = ledger.journals.filter(
      (journal) =>
        journal.effectiveDate <= input.effectiveAsOf &&
        Date.parse(journal.occurredAt) <= recordedCutoff,
    );
    if (journals.length + entries.length > 1000)
      throw new KernelError(
        'FINANCE_REPORT_LIMIT',
        'The as-of projection exceeds 1000 journals; choose an exact record until paginated reporting is available',
        422,
      );
    const posted = postedCapacity(entries);
    const insurance = new Map(
      selected.financials.allocations.map((item) => [
        item.participantId,
        BigInt(item.premiumMinor),
      ]),
    );
    const participants = [...new Set([...insurance.keys(), ...posted.keys()])].sort(compare);
    records.push({
      recordId: selected.id,
      recordVersion: selected.version,
      recordHash: selected.recordHash,
      productId: selected.productId,
      externalQuoteReference: selected.quote.sourceQuote.reference,
      sourceMode: selected.sourceMode,
      status: selected.status,
      currency: selected.currency,
      effectiveDate: event.effectiveDate ?? selected.quote.term.startDate,
      recordedAt: event.createdAt,
      insurancePremiumMinor: selected.premiumMinor,
      insuranceCommissionMinor: selected.financials.commission.amountMinor,
      posted: totals(entries),
      capacity: participants.map((participantId) => ({
        participantId,
        insurancePremiumMinor: minor(insurance.get(participantId) ?? 0n),
        postedPremiumMinor: minor(posted.get(participantId) ?? 0n),
      })),
      unpostedVersions: eligible
        .filter(
          (revision) =>
            !entries.some(
              (journal) =>
                journal.kind === 'insurance_transaction' &&
                journal.insuranceVersion === revision.version,
            ),
        )
        .map((revision) => revision.version),
    });
    for (const journal of entries)
      journals.push({
        journalId: journal.id,
        journalHash: journal.journalHash,
        recordId: journal.recordId,
        insuranceVersion: journal.insuranceVersion,
        insuranceHash: journal.insuranceHash,
        effectiveDate: journal.effectiveDate,
        recordedAt: journal.occurredAt,
        currency: journal.currency,
        kind: journal.kind,
        ...totals([journal]),
        capacity: [...postedCapacity([journal])]
          .sort(([a], [b]) => compare(a, b))
          .map(([participantId, amount]) => ({ participantId, premiumMinor: minor(amount) })),
      });
  }
  const currencies: FinancialReport['currencies'] = [
    ...new Set(records.map((record) => record.currency)),
  ]
    .sort(compare)
    .map((currency) => {
      const selected = records.filter((record) => record.currency === currency);
      const capacity = new Map<string, { insurance: bigint; posted: bigint }>();
      for (const record of selected)
        for (const entry of record.capacity) {
          const value = capacity.get(entry.participantId) ?? { insurance: 0n, posted: 0n };
          value.insurance += BigInt(entry.insurancePremiumMinor);
          value.posted += BigInt(entry.postedPremiumMinor);
          capacity.set(entry.participantId, value);
        }
      const sum = (field: keyof FinancialReport['records'][number]['posted']) =>
        minor(selected.reduce((total, record) => total + BigInt(record.posted[field]), 0n));
      return {
        currency,
        recordCount: selected.length,
        insurancePremiumMinor: minor(
          selected.reduce((total, record) => total + BigInt(record.insurancePremiumMinor), 0n),
        ),
        insuranceCommissionMinor: minor(
          selected.reduce((total, record) => total + BigInt(record.insuranceCommissionMinor), 0n),
        ),
        externalPremiumMinor: sum('externalPremiumMinor'),
        commissionAccruedMinor: sum('commissionAccruedMinor'),
        commissionReceivedMinor: sum('commissionReceivedMinor'),
        commissionOutstandingMinor: sum('commissionOutstandingMinor'),
        capacity: [...capacity]
          .sort(([a], [b]) => compare(a, b))
          .map(([participantId, value]) => ({
            participantId,
            insurancePremiumMinor: minor(value.insurance),
            postedPremiumMinor: minor(value.posted),
          })),
      };
    });
  const content = {
    reportVersion: 'financial-as-of-v1' as const,
    scope: {
      workspaceId: scope.workspaceId,
      tenantId: scope.tenantId,
      environment: scope.environment,
      operatingEntityId: scope.operatingEntityId,
    },
    selectedRecordId: input.recordId ?? null,
    effectiveAsOf: input.effectiveAsOf,
    recordedAsOf,
    accountingBasis: 'synthetic_external_custody_commission_v1' as const,
    sourceClaims: 'unverified' as const,
    records,
    currencies,
    journals,
    limitations: [
      'Synthetic training projection; customer accounting approval, source claims, BDX and regulatory mappings remain unverified.',
      'Insurance selects the latest retained bound or serviced revision effective by the date and recorded by the UTC instant. Quotes are excluded.',
      'Posted totals include only immutable journals satisfying both cutoffs. Unposted revisions are explicit; effective dates never replace recording times.',
      'External premium and capacity are memorandum control amounts, never Facio client cash or premium receivables. Currency totals are separate; no FX conversion is performed.',
      'Receipt cash means synthetic amounts applied through journals. Unapplied scope receipts are excluded from this record/portfolio projection; inspect the receipt register separately.',
      'The projection is bounded at 100 records and 1000 journals and fails if those bounds or exact-money totals overflow; it never silently truncates.',
    ],
  };
  return financialReportSchema.parse({ ...content, reportHash: hash(content) });
}

export function exportFinancialReport(report: FinancialReport) {
  const cell = (value: unknown) =>
    '"' +
    String(value ?? '')
      .replace(/^[=+\-@\t\r]/, (c) => (/^-?(0|[1-9]\d*)$/.test(String(value)) ? c : "'" + c))
      .replaceAll('"', '""') +
    '"';
  const rows: unknown[][] = [
    [
      'row_type',
      'report_hash',
      'effective_as_of',
      'recorded_as_of',
      'currency',
      'record_id',
      'record_version',
      'record_hash',
      'product_id',
      'external_quote_reference',
      'status',
      'effective_date',
      'recorded_at',
      'participant_id',
      'journal_id',
      'journal_hash',
      'journal_kind',
      'insurance_premium_minor',
      'insurance_commission_minor',
      'external_premium_minor',
      'commission_accrued_minor',
      'commission_received_minor',
      'commission_outstanding_minor',
      'insurance_capacity_minor',
      'posted_capacity_minor',
      'unposted_versions',
    ],
  ];
  rows.push([
    'report',
    report.reportHash,
    report.effectiveAsOf,
    report.recordedAsOf,
    ...Array.from({ length: 22 }, () => ''),
  ]);
  const prefix = (type: string, currency: string) => [
    type,
    report.reportHash,
    report.effectiveAsOf,
    report.recordedAsOf,
    currency,
  ];
  for (const record of report.records) {
    rows.push([
      ...prefix('insurance_record', record.currency),
      record.recordId,
      record.recordVersion,
      record.recordHash,
      record.productId,
      record.externalQuoteReference,
      record.status,
      record.effectiveDate,
      record.recordedAt,
      '',
      '',
      '',
      '',
      record.insurancePremiumMinor,
      record.insuranceCommissionMinor,
      record.posted.externalPremiumMinor,
      record.posted.commissionAccruedMinor,
      record.posted.commissionReceivedMinor,
      record.posted.commissionOutstandingMinor,
      '',
      '',
      record.unpostedVersions.join(';'),
    ]);
    for (const entry of record.capacity)
      rows.push([
        ...prefix('record_capacity', record.currency),
        record.recordId,
        record.recordVersion,
        record.recordHash,
        record.productId,
        '',
        record.status,
        record.effectiveDate,
        record.recordedAt,
        entry.participantId,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        entry.insurancePremiumMinor,
        entry.postedPremiumMinor,
        '',
      ]);
  }
  for (const journal of report.journals) {
    rows.push([
      ...prefix('journal', journal.currency),
      journal.recordId,
      journal.insuranceVersion,
      journal.insuranceHash,
      '',
      '',
      '',
      journal.effectiveDate,
      journal.recordedAt,
      '',
      journal.journalId,
      journal.journalHash,
      journal.kind,
      '',
      '',
      journal.externalPremiumMinor,
      journal.commissionAccruedMinor,
      journal.commissionReceivedMinor,
      journal.commissionOutstandingMinor,
      '',
      '',
      '',
    ]);
    for (const entry of journal.capacity)
      rows.push([
        ...prefix('journal_capacity', journal.currency),
        journal.recordId,
        journal.insuranceVersion,
        journal.insuranceHash,
        '',
        '',
        '',
        journal.effectiveDate,
        journal.recordedAt,
        entry.participantId,
        journal.journalId,
        journal.journalHash,
        journal.kind,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        entry.premiumMinor,
        '',
      ]);
  }
  for (const value of report.currencies) {
    rows.push([
      ...prefix('currency_total', value.currency),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      value.insurancePremiumMinor,
      value.insuranceCommissionMinor,
      value.externalPremiumMinor,
      value.commissionAccruedMinor,
      value.commissionReceivedMinor,
      value.commissionOutstandingMinor,
      '',
      '',
      '',
    ]);
    for (const entry of value.capacity)
      rows.push([
        ...prefix('currency_capacity', value.currency),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        entry.participantId,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        entry.insurancePremiumMinor,
        entry.postedPremiumMinor,
        '',
      ]);
  }
  rows[0]!.push(
    'workspace_id',
    'tenant_id',
    'environment',
    'operating_entity_id',
    'accounting_basis',
    'source_claims',
  );
  for (const row of rows.slice(1))
    row.push(
      report.scope.workspaceId,
      report.scope.tenantId,
      report.scope.environment,
      report.scope.operatingEntityId,
      report.accountingBasis,
      report.sourceClaims,
    );
  if (rows.length > 20000)
    throw new KernelError(
      'FINANCE_REPORT_LIMIT',
      'The CSV projection exceeds 20000 rows; choose an exact record until paginated export is available',
      422,
    );
  const content = rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
  if (content.length > 10_000_000)
    throw new KernelError(
      'FINANCE_REPORT_LIMIT',
      'The CSV projection exceeds its bounded size; choose an exact record until paginated export is available',
      422,
    );
  return {
    reportHash: report.reportHash,
    contentHash: createHash('sha256').update(content).digest('hex'),
    fileName: `training-financial-as-of-${report.effectiveAsOf}.csv`,
    mediaType: 'text/csv;charset=utf-8' as const,
    content,
    effectiveAsOf: report.effectiveAsOf,
    recordedAsOf: report.recordedAsOf,
    totals: report.currencies,
  };
}
