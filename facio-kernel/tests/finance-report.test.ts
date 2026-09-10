import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Kernel } from '../src/application/kernel.js';
import { Store } from '../src/storage/store.js';
import { KernelError, hash } from '../src/domain/canonical.js';
import { financialReportSchema, financeReportOperations } from '../src/contracts/finance-report.js';
import { financeLedgerSchema } from '../src/contracts/finance.js';
import { insuranceMutationResultSchema, type InsuranceRecord } from '../src/contracts/insurance.js';
import type { Context } from '../src/contracts/configuration.js';
import {
  insuranceContext,
  scopedRuntimePolicy,
  runtimePolicy,
  externalQuote,
} from './fixtures/insurance.js';

const context: Context = {
  ...insuranceContext,
  permissions: [
    ...insuranceContext.permissions,
    'finance:read',
    'finance:post',
    'finance:reconcile',
  ],
};
const evidence = () => ({
  idempotencyKey: randomUUID(),
  reason: 'Synthetic as-of report verification',
  evidenceRefs: ['fixture://financial-report'],
});
const target = (record: InsuranceRecord) => ({
  recordId: record.id,
  expectedVersion: record.version,
  recordHash: record.recordHash,
});
const code = (value: string) => (error: unknown) =>
  error instanceof KernelError && error.code === value;
function fixture() {
  const store = new Store(':memory:');
  let instant = '2026-09-10T10:00:00.000Z';
  const dollarPolicy = { ...runtimePolicy, id: 'manual-dollar', currency: 'USD' as const };
  const kernel = new Kernel(
    store,
    [],
    [
      scopedRuntimePolicy,
      { scope: scopedRuntimePolicy.scope, policy: dollarPolicy, policyHash: hash(dollarPolicy) },
    ],
    () => new Date(instant),
  );
  const execute = (name: Parameters<Kernel['execute']>[0], input: unknown, actor = context) =>
    kernel.execute(name, input, actor);
  const create = (currency = 'GBP', premiumMinor = '10001', reference: string = randomUUID()) => {
    const quote = insuranceMutationResultSchema.parse(
      execute('insurance_create_quote', {
        idempotencyKey: randomUUID(),
        productId: currency === 'GBP' ? runtimePolicy.id : dollarPolicy.id,
        productVersion: '1.0.0',
        quote: {
          ...externalQuote,
          premiumMinor,
          sourceQuote: { ...externalQuote.sourceQuote, reference },
        },
      }),
    ).record;
    return insuranceMutationResultSchema.parse(
      execute('insurance_bind', {
        idempotencyKey: randomUUID(),
        recordId: quote.id,
        expectedVersion: quote.version,
        quoteHash: quote.quoteHash,
      }),
    ).record;
  };
  const post = (record: InsuranceRecord) =>
    financeLedgerSchema.parse(
      execute('finance_post', {
        ...evidence(),
        ...target(record),
        accountingBasis: 'synthetic_external_custody_commission_v1',
      }),
    );
  const report = (effectiveAsOf = '2026-09-10', recordedAsOf = instant, recordId?: string) =>
    financialReportSchema.parse(
      execute('finance_report', { effectiveAsOf, recordedAsOf, ...(recordId ? { recordId } : {}) }),
    );
  return {
    store,
    execute,
    create,
    post,
    report,
    at: (value: string) => {
      instant = value;
    },
  };
}

test('effective and recorded cutoffs preserve earlier insurance and unposted states after later backdated service and postings', () => {
  const f = fixture();
  try {
    const bound = f.create();
    f.at('2026-09-10T10:30:00.000Z');
    const before = f.report();
    assert.equal(before.records[0]!.insurancePremiumMinor, '10001');
    assert.equal(before.records[0]!.posted.externalPremiumMinor, '0');
    assert.deepEqual(before.records[0]!.unpostedVersions, [2]);
    f.at('2026-09-10T11:00:00.000Z');
    f.post(bound);
    assert.deepEqual(f.report('2026-09-10', before.recordedAsOf), before);
    const afterBind = f.report();
    assert.equal(afterBind.currencies[0]!.externalPremiumMinor, '10001');
    f.at('2026-09-10T12:00:00.000Z');
    const revised = insuranceMutationResultSchema.parse(
      f.execute('insurance_service', {
        idempotencyKey: randomUUID(),
        reason: 'Synthetic backdated endorsement',
        ...target(bound),
        action: 'endorsement',
        premiumDeltaMinor: '4',
        effectiveDate: '2026-09-05',
      }),
    ).record;
    f.at('2026-09-10T13:00:00.000Z');
    f.post(revised);
    assert.deepEqual(f.report('2026-09-10', afterBind.recordedAsOf), afterBind);
    const beforeEffective = f.report('2026-09-04');
    assert.equal(beforeEffective.records[0]!.recordVersion, 2);
    assert.equal(beforeEffective.currencies[0]!.externalPremiumMinor, '10001');
    const after = f.report();
    assert.equal(after.records[0]!.recordVersion, 3);
    assert.equal(after.records[0]!.recordHash, revised.recordHash);
    assert.equal(after.currencies[0]!.insurancePremiumMinor, '10005');
    assert.equal(after.currencies[0]!.commissionAccruedMinor, '1001');
    assert.deepEqual(after.records[0]!.unpostedVersions, []);
    assert.equal(after.journals[1]!.externalPremiumMinor, '4');
    assert.equal(
      after.currencies[0]!.capacity.reduce(
        (sum, item) => sum + BigInt(item.postedPremiumMinor),
        0n,
      ),
      10005n,
    );
    assert.equal(f.report('2026-08-31').records.length, 0);
  } finally {
    f.store.close();
  }
});

test('currency and capacity totals stay separate, exact-record selection narrows scope, and CSV carries the identical projection', () => {
  const f = fixture();
  try {
    const gbp = f.create('GBP', '10001', '=untrusted-external-reference');
    const usd = f.create('USD', '20003');
    f.post(gbp);
    f.post(usd);
    const report = f.report();
    assert.deepEqual(
      report.currencies.map((row) => [
        row.currency,
        row.insurancePremiumMinor,
        row.externalPremiumMinor,
      ]),
      [
        ['GBP', '10001', '10001'],
        ['USD', '20003', '20003'],
      ],
    );
    assert.equal(f.report('2026-09-10', report.recordedAsOf, usd.id).records.length, 1);
    assert.equal(
      f.report('2026-09-10', report.recordedAsOf, usd.id).currencies[0]!.currency,
      'USD',
    );
    const csv = financeReportOperations.finance_report_export.output.parse(
      f.execute('finance_report_export', {
        effectiveAsOf: report.effectiveAsOf,
        recordedAsOf: report.recordedAsOf,
      }),
    );
    assert.equal(csv.reportHash, report.reportHash);
    assert.deepEqual(csv.totals, report.currencies);
    assert.equal(csv.contentHash, createHash('sha256').update(csv.content).digest('hex'));
    assert.ok(csv.content.includes('"\'=untrusted-external-reference"'));
    assert.ok(csv.content.includes('"journal_capacity"'));
    // This fixture contains no quotes/commas inside cells; assert the shared column positions explicitly.
    const rows = csv.content
      .trim()
      .split('\r\n')
      .map((row) => row.split(',').map((cell) => cell.slice(1, -1)));
    for (const row of rows) assert.equal(row.length, 32);
    assert.equal(rows[1]![0], 'report');
    assert.equal(rows[1]![26], context.workspaceId);
    assert.equal(rows[1]![28], context.environment);
    const gbpTotal = rows.find((row) => row[0] === 'currency_total' && row[4] === 'GBP')!;
    assert.equal(gbpTotal[17], '10001');
    assert.equal(gbpTotal[19], '10001');
    for (const record of report.records) assert.ok(csv.content.includes(record.recordHash));
  } finally {
    f.store.close();
  }
});

test('receipt applications and reversals enter reports only at their recorded and effective journal cutoffs', () => {
  const f = fixture();
  try {
    const record = f.create();
    const ledger = f.post(record);
    f.at('2026-09-10T11:00:00.000Z');
    const receipt = f.execute('finance_record_receipt', {
      ...evidence(),
      amountMinor: '800',
      payerId: 'settlement',
      sourceReference: 'as-of-receipt',
      currency: 'GBP',
      receivedAt: '2026-09-10T10:00:00.000Z',
      provenance: 'synthetic_training',
    }) as { id: string };
    const current = financeLedgerSchema.parse(f.execute('finance_ledger', { recordId: record.id }));
    f.at('2026-09-10T12:00:00.000Z');
    const applied = financeLedgerSchema.parse(
      f.execute('finance_apply_receipt', {
        ...evidence(),
        ...target(record),
        expectedLedgerHash: current.ledgerHash,
        receiptId: receipt.id,
        amountMinor: '500',
      }),
    );
    assert.equal(
      f.report('2026-09-10', '2026-09-10T11:30:00.000Z').currencies[0]!.commissionReceivedMinor,
      '0',
    );
    const after = f.report();
    assert.equal(after.currencies[0]!.commissionReceivedMinor, '500');
    assert.equal(f.report('2026-09-09').currencies[0]!.commissionReceivedMinor, '0');
    f.at('2026-09-10T13:00:00.000Z');
    f.execute('finance_reverse_application', {
      ...evidence(),
      ...target(record),
      expectedLedgerHash: applied.ledgerHash,
      applicationId: applied.applications[0]!.id,
    });
    assert.deepEqual(f.report('2026-09-10', after.recordedAsOf), after);
    assert.equal(f.report().currencies[0]!.commissionReceivedMinor, '0');
    assert.equal(
      ledger.totals.commissionOutstandingMinor,
      f.report().currencies[0]!.commissionOutstandingMinor,
    );
  } finally {
    f.store.close();
  }
});

test('report authorization, scope dimensions, real dates, future dates, aggregate overflow and bounded scope all fail closed', () => {
  const f = fixture();
  try {
    const record = f.create('GBP', '999999999999999999');
    const request = {
      recordId: record.id,
      effectiveAsOf: '2026-09-10',
      recordedAsOf: '2026-09-10T10:00:00.000Z',
    };
    assert.throws(() => f.execute('finance_report', request, insuranceContext), code('FORBIDDEN'));
    for (const change of [
      { tenantId: 'other' },
      { workspaceId: 'other' },
      { operatingEntityId: 'other' },
      { environment: 'sandbox' as const },
    ])
      assert.throws(
        () => f.execute('finance_report', request, { ...context, ...change }),
        code('NOT_FOUND'),
      );
    assert.throws(
      () => f.execute('finance_report', { ...request, effectiveAsOf: '2026-02-30' }),
      code('VALIDATION_ERROR'),
    );
    assert.throws(
      () => f.execute('finance_report', { ...request, effectiveAsOf: '2026-09-11' }),
      code('FINANCE_REPORT_DATE_INVALID'),
    );
    assert.throws(
      () => f.execute('finance_report', { ...request, recordedAsOf: '2026-09-11T00:00:00.000Z' }),
      code('FINANCE_REPORT_DATE_INVALID'),
    );
    assert.throws(
      () => f.execute('finance_report', { ...request, tenantId: 'other' }),
      code('VALIDATION_ERROR'),
    );
    f.create('GBP', '999999999999999999');
    assert.throws(() => f.report(), code('MONEY_OVERFLOW'));
    assert.equal(
      f.report(request.effectiveAsOf, request.recordedAsOf, record.id).records.length,
      1,
    );
    for (let index = 0; index < 99; index++) f.create('GBP', '1');
    assert.throws(() => f.report(), code('FINANCE_REPORT_LIMIT'));
  } finally {
    f.store.close();
  }
});
