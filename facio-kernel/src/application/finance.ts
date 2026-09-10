import { financialReport, exportFinancialReport } from './finance-report.js';
import { financialReportInputSchema } from '../contracts/finance-report.js';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { Context, Scope } from '../contracts/configuration.js';
import type { InsuranceRecord } from '../contracts/insurance.js';
import { minorUnitSchema } from '../contracts/money.js';
import {
  financeOperations,
  financeLedgerSchema,
  financeJournalSchema,
  financeReceiptSchema,
  financeApplicationSchema,
  type FinanceOperationName,
  type FinanceJournal,
  type FinanceReceipt,
  type FinanceApplication as ReceiptApplication,
  type FinanceLedger,
} from '../contracts/finance.js';
import { hash, KernelError } from '../domain/canonical.js';
import type { Store } from '../storage/store.js';

const basis = 'synthetic_external_custody_commission_v1' as const;
const scopeOf = ({ workspaceId, tenantId, environment, operatingEntityId }: Context): Scope => ({
  workspaceId,
  tenantId,
  environment,
  operatingEntityId,
});
const minor = (value: bigint) => {
  const result = value.toString();
  if (!minorUnitSchema.safeParse(result).success)
    throw new KernelError(
      'MONEY_OVERFLOW',
      'Financial control total exceeds supported exact-money magnitude',
      422,
    );
  return result;
};
type Line = FinanceJournal['lines'][number];
const line = (
  book: Line['book'],
  account: Line['account'],
  partyId: string,
  debit: bigint,
): Line | null =>
  debit === 0n
    ? null
    : {
        book,
        account,
        partyId,
        debitMinor: minor(debit > 0n ? debit : 0n),
        creditMinor: minor(debit < 0n ? -debit : 0n),
      };
const lines = (...values: (Line | null)[]): Line[] =>
  values.filter((value): value is Line => value !== null);
const net = (entries: FinanceJournal[], account: Line['account']) =>
  entries
    .flatMap((entry) => entry.lines)
    .filter((entry) => entry.account === account)
    .reduce((sum, entry) => sum + BigInt(entry.debitMinor) - BigInt(entry.creditMinor), 0n);
const error = (code: string, message: string, status = 422): never => {
  throw new KernelError(code, message, status);
};

function postingLines(revision: InsuranceRecord, previous: InsuranceRecord | null): Line[] {
  const delta = BigInt(revision.premiumMinor) - BigInt(previous?.premiumMinor ?? '0');
  const commissionDelta =
    BigInt(revision.financials.commission.amountMinor) -
    BigInt(previous?.financials.commission.amountMinor ?? '0');
  const commission = revision.financials.commission;
  if (commission.cashCustody !== 'external')
    return error('ACCOUNTING_BASIS_UNSUPPORTED', 'This basis requires external premium custody');
  const allocations = new Map(
    (previous?.financials.allocations ?? []).map((value) => [
      value.participantId,
      BigInt(value.premiumMinor),
    ]),
  );
  for (const allocation of revision.financials.allocations)
    allocations.set(
      allocation.participantId,
      BigInt(allocation.premiumMinor) - (allocations.get(allocation.participantId) ?? 0n),
    );
  for (const old of previous?.financials.allocations ?? [])
    if (!revision.financials.allocations.some((value) => value.participantId === old.participantId))
      allocations.set(old.participantId, -BigInt(old.premiumMinor));
  return lines(
    line('external_premium_control', 'external_premium', commission.settlementPartyId, delta),
    ...[...allocations]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([party, amount]) =>
        line('external_premium_control', 'external_capacity', party, -amount),
      ),
    line('financial', 'commission_receivable', commission.settlementPartyId, commissionDelta),
    line('financial', 'commission_income', commission.recipientId, -commissionDelta),
  );
}

/** Recognition and reconciliation own financial writes. Insurance and bank authority remain separate. */
export class FinanceApplication {
  constructor(
    private readonly store: Store,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  execute(name: FinanceOperationName, raw: unknown, context: Context): unknown {
    const operation = financeOperations[name];
    if (!context.permissions.some((permission) => permission === operation.permission))
      return error('FORBIDDEN', 'This operation requires financial authority', 403);
    if (!['development', 'sandbox'].includes(context.environment))
      return error(
        'FINANCE_ENVIRONMENT_UNSUPPORTED',
        'This accounting basis is restricted to synthetic development and sandbox use',
        403,
      );
    const input = operation.input.parse(raw);
    if (name === 'finance_report' || name === 'finance_report_export') {
      const request = financialReportInputSchema.parse(input);
      const now = this.clock();
      if (
        Date.parse(request.recordedAsOf) > now.getTime() ||
        request.effectiveAsOf > now.toISOString().slice(0, 10)
      )
        return error(
          'FINANCE_REPORT_DATE_INVALID',
          'This projection accepts historical or current cutoffs, not future forecasts',
        );
      const report = financialReport(this.store, context, request, (scope, recordId) =>
        this.ledger(scope, recordId),
      );
      return name === 'finance_report' ? report : exportFinancialReport(report);
    }
    if (name === 'finance_ledger')
      return this.ledger(context, financeOperations.finance_ledger.input.parse(input).recordId);
    if (name === 'finance_export')
      return this.export(
        this.ledger(context, financeOperations.finance_export.input.parse(input).recordId),
      );
    if (!('idempotencyKey' in input))
      return error('INTERNAL_ERROR', 'Missing financial command identity', 500);
    const requestHash = hash(input);
    const replay = this.store.replay(context, name, input.idempotencyKey, requestHash);
    if (replay !== undefined) return operation.output.parse(replay);
    let result: unknown;
    if (name === 'finance_record_receipt') {
      const command = financeOperations.finance_record_receipt.input.parse(input);
      if (new Date(command.receivedAt).getTime() > this.clock().getTime())
        return error(
          'RECEIPT_DATE_INVALID',
          'A receipt cannot be recorded as already received in the future',
        );
      const { idempotencyKey: _, ...intent } = command;
      const intentHash = hash(intent);
      const existing = this.store.finance
        .receipts(context)
        .find((receipt) => receipt.sourceReference === command.sourceReference);
      if (existing) {
        if (existing.intentHash !== intentHash)
          return error(
            'RECEIPT_REFERENCE_CONFLICT',
            'This source reference already identifies different receipt evidence',
            409,
          );
        result = existing;
      } else {
        const content = {
          ...intent,
          id: randomUUID(),
          scope: scopeOf(context),
          intentHash,
          occurredAt: this.clock().toISOString(),
          actorId: context.actorId,
          correlationId: context.correlationId,
        };
        const receipt = financeReceiptSchema.parse({ ...content, receiptHash: hash(content) });
        this.store.finance.appendReceipt(receipt);
        result = receipt;
      }
    } else {
      const target =
        name === 'finance_post'
          ? financeOperations.finance_post.input.parse(raw)
          : name === 'finance_apply_receipt'
            ? financeOperations.finance_apply_receipt.input.parse(raw)
            : financeOperations.finance_reverse_application.input.parse(raw);
      const record = this.store.insuranceRead(context, target.recordId);
      if (record.version !== target.expectedVersion || record.recordHash !== target.recordHash)
        return error(
          'VERSION_CONFLICT',
          'The insurance transaction changed; refresh financial evidence before proceeding',
          409,
        );
      if (record.status === 'quoted')
        return error(
          'FINANCE_NOT_BOUND',
          'An unbound quote cannot create a recognized insurance receivable',
        );
      const ledger = this.ledger(context, record.id);
      if (name === 'finance_post') {
        const command = financeOperations.finance_post.input.parse(input);
        const history = this.store.insuranceHistory(context, record.id);
        let previous: InsuranceRecord | null = null;
        for (const revision of history.revisions) {
          if (revision.status === 'quoted') continue;
          const sourceEvent = history.events.find((event) => event.version === revision.version)!;
          if (ledger.unpostedVersions.includes(revision.version)) {
            this.appendJournal(context, revision, {
              kind: 'insurance_transaction',
              originKey: `insurance:${record.id}:${revision.version}`,
              effectiveDate: sourceEvent.effectiveDate ?? revision.quote.term.startDate,
              reason: command.reason,
              evidenceRefs: command.evidenceRefs,
              lines: postingLines(revision, previous),
            });
          }
          previous = revision;
        }
      } else {
        const command =
          name === 'finance_apply_receipt'
            ? financeOperations.finance_apply_receipt.input.parse(raw)
            : financeOperations.finance_reverse_application.input.parse(raw);
        if (ledger.ledgerHash !== command.expectedLedgerHash)
          return error(
            'FINANCE_VERSION_CONFLICT',
            'Receipt or ledger evidence changed; inspect the current balances before reconciling',
            409,
          );
        if (ledger.unpostedVersions.length)
          return error(
            'FINANCE_UNPOSTED_TRANSACTIONS',
            'Recognize all retained insurance transactions before applying a receipt',
          );
        if (name === 'finance_apply_receipt') {
          const request = financeOperations.finance_apply_receipt.input.parse(input);
          const receiptView = ledger.receipts.find((item) => item.receipt.id === request.receiptId);
          if (!receiptView)
            return error(
              'NOT_FOUND',
              'No eligible receipt exists in this authorized scope and currency',
              404,
            );
          const receipt = receiptView.receipt;
          if (receipt.payerId !== record.financials.commission.settlementPartyId)
            return error(
              'RECEIPT_PAYER_MISMATCH',
              'The recorded payer does not match the retained commission settlement party',
            );
          const amount = BigInt(request.amountMinor);
          if (
            amount > BigInt(receiptView.unappliedMinor) ||
            amount > BigInt(ledger.totals.commissionOutstandingMinor)
          )
            return error(
              'RECEIPT_OVERALLOCATION',
              'The amount exceeds available receipt money or outstanding commission',
            );
          this.application(
            context,
            record,
            receipt,
            amount,
            null,
            request.reason,
            request.evidenceRefs,
          );
        } else {
          const request = financeOperations.finance_reverse_application.input.parse(input);
          const application = ledger.applications.find(
            (item) => item.id === request.applicationId && item.kind === 'apply',
          );
          if (!application)
            return error('NOT_FOUND', 'No receipt application exists for the selected record', 404);
          if (ledger.applications.some((item) => item.reversesId === application.id))
            return error(
              'APPLICATION_ALREADY_REVERSED',
              'This application already has its immutable reversal',
              409,
            );
          const receipt = ledger.receipts.find(
            (item) => item.receipt.id === application.receiptId,
          )!.receipt;
          this.application(
            context,
            record,
            receipt,
            BigInt(application.amountMinor),
            application.id,
            request.reason,
            request.evidenceRefs,
          );
        }
      }
      result = this.ledger(context, record.id);
    }
    result = operation.output.parse(result);
    this.store.remember(context, name, input.idempotencyKey, requestHash, result);
    return result;
  }

  private appendJournal(
    context: Context,
    record: InsuranceRecord,
    input: Pick<
      FinanceJournal,
      'kind' | 'originKey' | 'effectiveDate' | 'reason' | 'evidenceRefs' | 'lines'
    >,
  ): FinanceJournal {
    const previous = this.store.finance.journals(context, record.id);
    const content = {
      ...input,
      id: randomUUID(),
      scope: scopeOf(context),
      recordId: record.id,
      sequence: previous.length + 1,
      previousJournalHash: previous.at(-1)?.journalHash ?? null,
      insuranceVersion: record.version,
      insuranceHash: record.recordHash,
      currency: record.currency,
      occurredAt: this.clock().toISOString(),
      actorId: context.actorId,
      correlationId: context.correlationId,
      accountingBasis: basis,
    };
    const journal = financeJournalSchema.parse({ ...content, journalHash: hash(content) });
    this.store.finance.appendJournal(journal);
    return journal;
  }
  private application(
    context: Context,
    record: InsuranceRecord,
    receipt: FinanceReceipt,
    amount: bigint,
    reversesId: string | null,
    reason: string,
    evidenceRefs: string[],
  ) {
    const id = randomUUID();
    const signed = reversesId ? -amount : amount;
    const journal = this.appendJournal(context, record, {
      kind: reversesId ? 'application_reversal' : 'receipt_application',
      originKey: `receipt-application:${id}`,
      effectiveDate: this.clock().toISOString().slice(0, 10),
      reason,
      evidenceRefs,
      lines: lines(
        line('financial', 'recorded_commission_cash', receipt.payerId, signed),
        line('financial', 'commission_receivable', receipt.payerId, -signed),
      ),
    });
    const content = {
      id,
      scope: scopeOf(context),
      recordId: record.id,
      receiptId: receipt.id,
      receiptHash: receipt.receiptHash,
      journalId: journal.id,
      journalHash: journal.journalHash,
      kind: reversesId ? ('reverse' as const) : ('apply' as const),
      reversesId,
      amountMinor: minor(amount),
      currency: receipt.currency,
      reason,
      evidenceRefs,
      occurredAt: this.clock().toISOString(),
      actorId: context.actorId,
      correlationId: context.correlationId,
    };
    this.store.finance.appendApplication(
      financeApplicationSchema.parse({ ...content, applicationHash: hash(content) }),
    );
  }

  ledger(scope: Scope, recordId: string): FinanceLedger {
    const history = this.store.insuranceHistory(scope, recordId);
    const record = history.revisions.at(-1)!;
    const journals = this.store.finance.journals(scope, recordId);
    const receipts = this.store.finance.receipts(scope);
    const allApplications = this.store.finance.applications(scope);
    const journalCache = new Map([[recordId, journals]]);
    const applied = new Map<string, bigint>();
    const seenApplications = new Map<string, ReceiptApplication>();
    const reversed = new Set<string>();
    for (const application of allApplications) {
      const receipt = receipts.find((item) => item.id === application.receiptId);
      let relatedJournals = journalCache.get(application.recordId);
      if (!relatedJournals) {
        relatedJournals = this.store.finance.journals(scope, application.recordId);
        this.validateJournalSources(
          scope,
          application.recordId,
          relatedJournals,
          allApplications,
          receipts,
        );
        journalCache.set(application.recordId, relatedJournals);
      }
      const journal = relatedJournals.find((item) => item.id === application.journalId);
      if (
        !receipt ||
        receipt.receiptHash !== application.receiptHash ||
        receipt.currency !== application.currency ||
        !journal ||
        journal.journalHash !== application.journalHash ||
        journal.originKey !== `receipt-application:${application.id}`
      )
        return error(
          'FINANCE_INTEGRITY_ERROR',
          'Receipt application does not match its immutable source and journal',
          500,
        );
      const original = application.reversesId
        ? seenApplications.get(application.reversesId)
        : undefined;
      if (
        application.kind === 'reverse' &&
        (!original ||
          original.kind !== 'apply' ||
          original.receiptId !== application.receiptId ||
          original.recordId !== application.recordId ||
          original.amountMinor !== application.amountMinor ||
          reversed.has(original.id))
      )
        return error(
          'FINANCE_INTEGRITY_ERROR',
          'Receipt reversal does not match an unreversed application',
          500,
        );
      if (application.kind === 'apply' && application.reversesId !== null)
        return error(
          'FINANCE_INTEGRITY_ERROR',
          'Original receipt application contains a reversal reference',
          500,
        );
      const amount = BigInt(application.amountMinor) * (application.kind === 'apply' ? 1n : -1n);
      if (
        journal.currency !== application.currency ||
        journal.kind !==
          (application.kind === 'apply' ? 'receipt_application' : 'application_reversal') ||
        hash(journal.lines) !==
          hash(
            lines(
              line('financial', 'recorded_commission_cash', receipt.payerId, amount),
              line('financial', 'commission_receivable', receipt.payerId, -amount),
            ),
          )
      )
        return error(
          'FINANCE_INTEGRITY_ERROR',
          'Receipt application journal has inconsistent amounts',
          500,
        );
      const total = (applied.get(receipt.id) ?? 0n) + amount;
      if (total < 0n || total > BigInt(receipt.amountMinor))
        return error(
          'FINANCE_INTEGRITY_ERROR',
          'Receipt allocation exceeds its retained amount',
          500,
        );
      applied.set(receipt.id, total);
      seenApplications.set(application.id, application);
      if (original) reversed.add(original.id);
    }
    const postedVersions = this.validateJournalSources(
      scope,
      recordId,
      journals,
      allApplications,
      receipts,
    );
    const applications = allApplications.filter((item) => item.recordId === recordId);
    const receiptViews = receipts
      .filter((receipt) => receipt.currency === record.currency)
      .map((receipt) => ({
        receipt,
        appliedMinor: minor(applied.get(receipt.id) ?? 0n),
        unappliedMinor: minor(BigInt(receipt.amountMinor) - (applied.get(receipt.id) ?? 0n)),
      }));
    const capacity = new Map<string, bigint>();
    for (const entry of journals
      .flatMap((journal) => journal.lines)
      .filter((entry) => entry.account === 'external_capacity'))
      capacity.set(
        entry.partyId,
        (capacity.get(entry.partyId) ?? 0n) + BigInt(entry.creditMinor) - BigInt(entry.debitMinor),
      );
    const totals = {
      externalPremiumMinor: minor(net(journals, 'external_premium')),
      commissionAccruedMinor: minor(-net(journals, 'commission_income')),
      commissionReceivedMinor: minor(net(journals, 'recorded_commission_cash')),
      commissionOutstandingMinor: minor(net(journals, 'commission_receivable')),
      recordedUnappliedReceiptMinor: minor(
        receiptViews.reduce((sum, item) => sum + BigInt(item.unappliedMinor), 0n),
      ),
    };
    if (
      BigInt(totals.commissionAccruedMinor) - BigInt(totals.commissionReceivedMinor) !==
      BigInt(totals.commissionOutstandingMinor)
    )
      return error('FINANCE_INTEGRITY_ERROR', 'Commission control totals do not reconcile', 500);
    const content = {
      recordId,
      recordVersion: record.version,
      recordHash: record.recordHash,
      currency: record.currency,
      accountingBasis: basis,
      sourceClaims: 'unverified' as const,
      journals,
      applications,
      receipts: receiptViews,
      unpostedVersions: history.revisions
        .filter((item) => item.status !== 'quoted' && !postedVersions.has(item.version))
        .map((item) => item.version),
      totals,
      capacity: [...capacity]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([participantId, amount]) => ({ participantId, premiumMinor: minor(amount) })),
      limitations: [
        'Synthetic training accounting basis; customer accounting approval and source claims are unverified.',
        'External premium and capacity are memorandum control totals, never client cash or Facio premium receivables.',
        'Commission is recognized on explicitly posted insurance transactions; receipt evidence is synthetic and cannot satisfy payment, screening or bind requirements.',
        'No tax, fee, instalment, FX, refund payment, live bank connection or regulatory/BDX output is provided.',
        'Unapplied receipt totals include all recorded receipts in this authorized operating scope and currency; they are not policy income.',
      ],
    };
    return financeLedgerSchema.parse({ ...content, ledgerHash: hash(content) });
  }
  private validateJournalSources(
    scope: Scope,
    recordId: string,
    journals: FinanceJournal[],
    allApplications: ReceiptApplication[],
    receipts: FinanceReceipt[],
  ): Set<number> {
    const history = this.store.insuranceHistory(scope, recordId);
    let receivable = 0n;
    const postedVersions = new Set<number>();
    for (const journal of journals) {
      const source = history.revisions.find((item) => item.version === journal.insuranceVersion);
      if (
        !source ||
        source.recordHash !== journal.insuranceHash ||
        source.status === 'quoted' ||
        journal.currency !== source.currency
      )
        return error(
          'FINANCE_INTEGRITY_ERROR',
          'Journal does not match its retained insurance transaction',
          500,
        );
      const sourceEvent = history.events.find((item) => item.version === source.version)!;
      if (Date.parse(journal.occurredAt) < Date.parse(sourceEvent.createdAt))
        return error(
          'FINANCE_INTEGRITY_ERROR',
          'Journal predates the retained insurance transaction',
          500,
        );
      if (journal.kind === 'insurance_transaction') {
        if (
          journal.originKey !== `insurance:${recordId}:${source.version}` ||
          postedVersions.has(source.version)
        )
          return error(
            'FINANCE_INTEGRITY_ERROR',
            'Insurance transaction was posted more than once',
            500,
          );
        const prior =
          history.revisions
            .filter((item) => item.version < source.version && item.status !== 'quoted')
            .at(-1) ?? null;
        const sourceEvent = history.events.find((item) => item.version === source.version)!;
        if (
          hash(journal.lines) !== hash(postingLines(source, prior)) ||
          journal.effectiveDate !== (sourceEvent.effectiveDate ?? source.quote.term.startDate)
        )
          return error(
            'FINANCE_INTEGRITY_ERROR',
            'Posted journal lines or effective date disagree with their exact insurance source',
            500,
          );
        postedVersions.add(source.version);
      } else {
        const application = allApplications.find((item) => item.journalId === journal.id);
        const receipt = receipts.find((item) => item.id === application?.receiptId);
        if (
          !application ||
          !receipt ||
          receipt.payerId !== source.financials.commission.settlementPartyId ||
          journal.effectiveDate !== journal.occurredAt.slice(0, 10) ||
          application.actorId !== journal.actorId ||
          application.correlationId !== journal.correlationId ||
          application.reason !== journal.reason ||
          hash(application.evidenceRefs) !== hash(journal.evidenceRefs) ||
          Date.parse(application.occurredAt) < Date.parse(journal.occurredAt) ||
          Date.parse(receipt.occurredAt) > Date.parse(journal.occurredAt)
        )
          return error(
            'FINANCE_INTEGRITY_ERROR',
            'Reconciliation journal does not match its retained source and audit evidence',
            500,
          );
        if (
          history.revisions.some(
            (item) =>
              item.status !== 'quoted' &&
              item.version <= source.version &&
              !postedVersions.has(item.version),
          )
        )
          return error(
            'FINANCE_INTEGRITY_ERROR',
            'Receipt reconciliation precedes insurance recognition',
            500,
          );
        if (journal.kind === 'receipt_application' && BigInt(application.amountMinor) > receivable)
          return error(
            'FINANCE_INTEGRITY_ERROR',
            'Receipt application exceeds commission outstanding at that journal version',
            500,
          );
      }
      receivable += net([journal], 'commission_receivable');
    }
    return postedVersions;
  }
  private export(ledger: FinanceLedger) {
    const cell = (value: unknown) =>
      '"' +
      String(value ?? '')
        .replace(/^[=+\-@\t\r]/, (character) => "'" + character)
        .replaceAll('"', '""') +
      '"';
    const rows: unknown[][] = [
      [
        'journal_id',
        'journal_hash',
        'record_id',
        'record_version',
        'record_hash',
        'effective_date',
        'recorded_at',
        'currency',
        'book',
        'account',
        'party_id',
        'debit_minor',
        'credit_minor',
        'origin',
        'accounting_basis',
      ],
    ];
    for (const journal of ledger.journals)
      for (const entry of journal.lines)
        rows.push([
          journal.id,
          journal.journalHash,
          journal.recordId,
          journal.insuranceVersion,
          journal.insuranceHash,
          journal.effectiveDate,
          journal.occurredAt,
          journal.currency,
          entry.book,
          entry.account,
          entry.partyId,
          entry.debitMinor,
          entry.creditMinor,
          journal.originKey,
          journal.accountingBasis,
        ]);
    const content = rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
    return {
      ledgerHash: ledger.ledgerHash,
      contentHash: createHash('sha256').update(content).digest('hex'),
      fileName: `training-ledger-${ledger.recordId}.csv`,
      mediaType: 'text/csv;charset=utf-8' as const,
      content,
      totals: ledger.totals,
    };
  }
}
